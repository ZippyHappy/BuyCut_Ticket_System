import { createHmac } from "node:crypto";
import { Pool } from "pg";
if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:true}:undefined});
const secret=process.env.BUYCUT_HASH_SECRET??"";
if(secret.length<32||secret.includes("replace-with"))throw new Error("BUYCUT_HASH_SECRET must be a unique random secret");
const stripeKey=()=>{const key=process.env.STRIPE_SECRET_KEY;if(!key)throw new Error("stripe_identity_not_configured");return `Basic ${Buffer.from(`${key}:`).toString("base64")}`};
async function stripe(path:string,init?:RequestInit){
 const response=await fetch(new URL(path,"https://api.stripe.com/v1/"),{...init,headers:{authorization:stripeKey(),...init?.headers},signal:AbortSignal.timeout(10000)});
 const body=await response.json() as Record<string,any>;
 if(!response.ok)throw new Error(`stripe_identity_http_${response.status}`);
 return body;
}
export async function createIdentitySession(accountId:string,returnUrl:string){
 const target=new URL(returnUrl),allowed=(process.env.IDENTITY_RETURN_HOSTS??"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(target.protocol!=="https:"||!allowed.includes(target.hostname.toLowerCase()))throw new Error("identity_return_url_not_allowed");
 const form=new URLSearchParams({type:"document",return_url:target.toString(),client_reference_id:accountId,"metadata[account_id]":accountId,"options[document][require_matching_selfie]":"true"});
 const r=await stripe("identity/verification_sessions",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form});
 if(typeof r.id!=="string"||typeof r.url!=="string")throw new Error("stripe_identity_invalid_response");
 const providerUrl=new URL(r.url),allowedProviderHosts=(process.env.IDENTITY_PROVIDER_REDIRECT_HOSTS??"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(providerUrl.protocol!=="https:"||!allowedProviderHosts.includes(providerUrl.hostname.toLowerCase()))throw new Error("stripe_identity_redirect_not_allowed");
 const sessionHash=createHmac("sha256",secret).update(r.id).digest("hex"),report=await pool.query("INSERT INTO identity_sessions(session_hash,account_id) VALUES($1,$2) RETURNING session_hash",[sessionHash,accountId]);
 if(!report.rowCount)throw new Error("identity_session_persist_failed");
 return{sessionId:r.id,url:providerUrl.toString()};
}
export async function checkIdentitySession(sessionId:string,accountId:string){
 const sessionHash=createHmac("sha256",secret).update(sessionId).digest("hex"),owned=await pool.query("SELECT 1 FROM identity_sessions WHERE session_hash=$1 AND account_id=$2",[sessionHash,accountId]);
 if(!owned.rowCount)throw new Error("identity_session_not_owned");
 const r=await stripe(`identity/verification_sessions/${encodeURIComponent(sessionId)}?expand%5B%5D=last_verification_report`);
 if(r.client_reference_id!==accountId||r.metadata?.account_id!==accountId)throw new Error("stripe_identity_account_mismatch");
 if(r.status==="processing"||r.status==="requires_input")return{status:"pending" as const};
 if(r.status==="canceled")return{status:"rejected" as const};
 if(r.status!=="verified")throw new Error("stripe_identity_invalid_status");
 const report=r.last_verification_report;
 if(!report||report.document?.status!=="verified"||report.selfie?.status!=="verified"||typeof report.document.number!=="string"||!report.document.number.trim())throw new Error("stripe_identity_checks_incomplete");
 const documentToken=createHmac("sha256",secret).update(`document-token:${sessionId}`).digest("hex");
 const fingerprint=createHmac("sha256",secret).update(report.document.number.trim().toUpperCase()).digest("hex");
 const documentHash=createHmac("sha256",secret).update(documentToken).digest("hex");
 const providerRef=createHmac("sha256",secret).update(sessionId).digest("hex");
 await pool.query("INSERT INTO verified_identities(account_id,document_hash,provider_reference_hash,face_match,expires_at,identity_fingerprint) VALUES($1,$2,$3,true,now()+interval '365 days',$4) ON CONFLICT(account_id) DO UPDATE SET document_hash=EXCLUDED.document_hash,provider_reference_hash=EXCLUDED.provider_reference_hash,face_match=true,verified_at=now(),expires_at=EXCLUDED.expires_at,identity_fingerprint=EXCLUDED.identity_fingerprint",[accountId,documentHash,providerRef,fingerprint]);
 await pool.query("UPDATE identity_sessions SET consumed_at=now() WHERE session_hash=$1",[sessionHash]);
 return{status:"verified" as const,documentToken};
}
export async function closeIdentityPool(){await pool.end()}

