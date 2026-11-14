import { createHmac, randomUUID } from "node:crypto";
import type { Evaluation, EvaluationInput } from "./types.js";
const LIMIT=4, TTL=10*60_000;
type Row={input:EvaluationInput;expires:number;status:"reserved"|"committed"};
const rows=new Map<string,Row>();
const secret=process.env.BUYCUT_HASH_SECRET??"local-development-only-change-me";
if(process.env.NODE_ENV==="production"&&secret==="local-development-only-change-me")throw new Error("Set BUYCUT_HASH_SECRET before production");
const digest=(s:string)=>createHmac("sha256",secret).update(s.trim().toLowerCase()).digest("hex");
function prune(){const now=Date.now();for(const [id,r] of rows)if(r.expires<=now)rows.delete(id)}
function used(event:string,key:string,value:string){let n=0;for(const r of rows.values())if(r.input.eventId===event&&digest(String((r.input.buyer as unknown as Record<string,unknown>)[key]??""))===digest(value))n+=r.input.quantity;return n}
export function evaluate(input:EvaluationInput):Evaluation{prune();const {buyer,eventId,quantity,ip}=input;
 // This in-memory engine is retained only for source compatibility. Production
 // decisions must go through the PostgreSQL adapter and verified-provider checks.
 return{id:"",decision:"review",reasonCodes:["legacy_engine_disabled"],expiresAt:new Date(Date.now()+TTL).toISOString()};
 const fields:[string,string][]=[["accountId",buyer.accountId],["email",buyer.email],["phone",buyer.phone],["documentToken",buyer.documentToken],["paymentToken",buyer.paymentToken??""]];
 if(fields.some(([,v])=>!v.trim()))return{id:"",decision:"review",reasonCodes:["buyer_signals_incomplete"],expiresAt:new Date(Date.now()+TTL).toISOString()};
 if(fields.some(([k,v])=>used(eventId,k,v)+quantity>LIMIT))return{id:"",decision:"block",reasonCodes:["purchase_limit_exceeded"],expiresAt:new Date(Date.now()+TTL).toISOString()};
 if(used(eventId,"ip",ip)+quantity>LIMIT)return{id:"",decision:"review",reasonCodes:["shared_ip_velocity"],expiresAt:new Date(Date.now()+TTL).toISOString()};
 const id=randomUUID(),expires=Date.now()+TTL;rows.set(id,{input,expires,status:"reserved"});return{id,decision:"allow",reasonCodes:[],expiresAt:new Date(expires).toISOString()}}
export function commit(id:string,quantity:number){prune();const r=rows.get(id);if(!r||r.status!=="reserved"||r.input.quantity!==quantity)return false;r.status="committed";return true}
export function release(id:string){const r=rows.get(id);if(!r||r.status!=="reserved")return false;return rows.delete(id)}

