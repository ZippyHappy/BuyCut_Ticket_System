import "dotenv/config";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { commit,evaluate,release,closePool,areContactsVerified,isIdentityVerified,checkDatabase } from "./adapters/postgres-store.js";
import { startOtp,confirmOtp,closeOtpPool } from "./core/verification.js";
import { ConfiguredOtpSender } from "./adapters/otp-sender.js";
import { ConfiguredRiskProvider } from "./adapters/risk-provider.js";
import { createIdentitySession,checkIdentitySession,closeIdentityPool } from "./adapters/identity-provider.js";
import type { EvaluationInput } from "./core/types.js";
if(!process.env.API_KEY||process.env.API_KEY.length<32||process.env.API_KEY.includes("replace-with"))throw new Error("Configure API_KEY with a unique random secret of at least 32 characters");
if(!process.env.BUYCUT_HASH_SECRET||process.env.BUYCUT_HASH_SECRET.length<32||process.env.BUYCUT_HASH_SECRET.includes("replace-with"))throw new Error("Configure BUYCUT_HASH_SECRET with a unique random secret of at least 32 characters");
const trustedProxy=process.env.TRUST_PROXY?.trim();
const app=Fastify({logger:true,trustProxy:!trustedProxy||trustedProxy.toLowerCase()==="false"?false:trustedProxy,bodyLimit:16_384});
await app.register(rateLimit,{max:60,timeWindow:"1 minute"});
app.addHook("onRequest",async(req,reply)=>{if(req.headers.authorization!==`Bearer ${process.env.API_KEY}`)return reply.code(401).send({error:"unauthorized"})});
const sender=new ConfiguredOtpSender(),riskProvider=new ConfiguredRiskProvider();
const ipReviewThreshold=Number(process.env.IP_REVIEW_THRESHOLD??4);if(!Number.isInteger(ipReviewThreshold)||ipReviewThreshold<1)throw new Error("IP_REVIEW_THRESHOLD must be a positive integer");
const identityStart=z.object({accountId:z.string().min(1).max(128),returnUrl:z.string().url()}).strict();
app.post("/v1/verifications/identity/start",async(req,reply)=>{const s=identityStart.safeParse(req.body);if(!s.success)return reply.code(400).send({error:"invalid_request"});try{return await createIdentitySession(s.data.accountId,s.data.returnUrl)}catch{return reply.code(503).send({error:"identity_provider_unavailable"})}});
app.post("/v1/verifications/identity/result",async(req,reply)=>{const s=z.object({sessionId:z.string().min(1).max(512),accountId:z.string().min(1).max(128)}).strict().safeParse(req.body);if(!s.success)return reply.code(400).send({error:"invalid_request"});try{const result=await checkIdentitySession(s.data.sessionId,s.data.accountId);if(result.status==="rejected")return reply.code(200).send({status:"rejected"});if(result.status==="pending")return reply.code(200).send({status:"pending"});return result}catch(error){req.log.error({err:error},"Identity provider check failed");return reply.code(503).send({error:"identity_provider_unavailable"})}});
const otpStart=z.object({channel:z.enum(["email","sms","whatsapp"]),contactType:z.enum(["email","phone"]),destination:z.string().min(7).max(254),accountId:z.string().min(1).max(128)}).strict().refine(v=>(v.contactType==="email")===(v.channel==="email"),{message:"channel_contact_type_mismatch"}).refine(v=>v.contactType==="email"?z.string().email().safeParse(v.destination).success:/^\+[1-9]\d{7,14}$/.test(v.destination),{message:"invalid_destination"});
app.post("/v1/verifications/otp/start",async(req,reply)=>{const s=otpStart.safeParse(req.body);if(!s.success)return reply.code(400).send({error:"invalid_request"});try{return await startOtp(s.data.channel,s.data.contactType,s.data.destination,s.data.accountId,sender)}catch(error){const reason=error instanceof Error?error.message:"";if(reason==="otp_rate_limited")return reply.code(429).send({error:"otp_rate_limited"});if(reason==="contact_already_linked")return reply.code(409).send({error:"contact_already_linked"});return reply.code(503).send({error:"otp_provider_unavailable"})}});
app.post("/v1/verifications/otp/confirm",async(req,reply)=>{const s=z.object({challengeId:z.string().uuid(),destination:z.string().min(7).max(254),code:z.string().regex(/^\d{6}$/),accountId:z.string().min(1).max(128),contactType:z.enum(["email","phone"])}).strict().safeParse(req.body);if(!s.success)return reply.code(400).send({error:"invalid_request"});try{return await confirmOtp(s.data.challengeId,s.data.destination,s.data.code,s.data.accountId,s.data.contactType)}catch{return reply.code(503).send({error:"otp_provider_unavailable"})}});
const schema=z.object({eventId:z.string().min(1).max(128),quantity:z.number().int().min(1).max(4),buyer:z.object({accountId:z.string().min(1).max(128),email:z.string().email().max(254),phone:z.string().min(7).max(20),documentToken:z.string().min(16).max(512),paymentToken:z.string().min(8).max(512),networkType:z.enum(["residential","mobile","hosting","unknown"]).optional(),locationCountry:z.string().length(2).optional()}).strict()}).strict();
app.post("/v1/purchases/evaluate",async(req,reply)=>{const parsed=schema.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"invalid_request"});const b=parsed.data.buyer;if(!await areContactsVerified(b.accountId,b.email,b.phone))return reply.code(403).send({error:"contacts_not_verified"});if(!await isIdentityVerified(b.accountId,b.documentToken))return reply.code(403).send({error:"identity_not_verified"});let risk;try{risk=await riskProvider.inspect(req.ip)}catch{return reply.code(503).send({error:"risk_provider_unavailable"})}const reasons:string[]=[];if(risk.vpnOrProxy)reasons.push("vpn_or_proxy_detected");if(risk.networkType==="hosting")reasons.push("hosting_network");if(risk.sharedIpPurchases>=ipReviewThreshold)reasons.push("high_ip_purchase_velocity");if(reasons.length)return{ id:"",decision:"review",reasonCodes:reasons,expiresAt:new Date(Date.now()+600000).toISOString(),risk:{networkType:risk.networkType,country:risk.country,sharedIpPurchases:risk.sharedIpPurchases}};const input:EvaluationInput={...parsed.data,ip:req.ip};return evaluate(input)});
app.post("/v1/purchases/commit",async(req,reply)=>{const s=z.object({evaluationId:z.string().uuid(),quantity:z.number().int().min(1).max(4)}).strict().safeParse(req.body);if(!s.success)return reply.code(400).send({error:"invalid_request"});return await commit(s.data.evaluationId,s.data.quantity)?{committed:true}:reply.code(409).send({error:"reservation_invalid"})});
app.post("/v1/purchases/release",async(req,reply)=>{const s=z.object({evaluationId:z.string().uuid()}).strict().safeParse(req.body);if(!s.success)return reply.code(400).send({error:"invalid_request"});return{released:await release(s.data.evaluationId)}});
app.get("/health",async(_req,reply)=>{try{await checkDatabase();return{status:"ok",database:"ok"}}catch{return reply.code(503).send({status:"unavailable",database:"unavailable"})}});
app.addHook("onClose",async()=>{await Promise.all([closePool(),closeOtpPool(),closeIdentityPool()])});
await app.listen({port:Number(process.env.PORT??3000),host:"0.0.0.0"});





