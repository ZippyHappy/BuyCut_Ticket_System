import { createHmac,randomInt,randomUUID,timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
export type Channel="email"|"sms"|"whatsapp";
export type ContactType="email"|"phone";
export interface OtpSender{send(channel:Channel,destination:string,code:string):Promise<void>}
export interface OtpChallenge{id:string;expiresAt:string}
if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:true}:undefined});
const secret=process.env.BUYCUT_HASH_SECRET??"";if(secret.length<32||secret.includes("replace-with"))throw new Error("BUYCUT_HASH_SECRET must be a unique random secret of at least 32 chars");
const canonical=(s:string,type:ContactType)=>type==="phone"?s.replace(/\D/g,""):s.trim().toLowerCase();
const mac=(s:string,type?:ContactType)=>createHmac("sha256",secret).update(type?canonical(s,type):s.trim().toLowerCase()).digest("hex");
export async function startOtp(channel:Channel,contactType:ContactType,destination:string,accountId:string,sender:OtpSender):Promise<OtpChallenge>{
 const subject=mac(destination,contactType),c=await pool.connect();
 const code=String(randomInt(0,1_000_000)).padStart(6,"0"),id=randomUUID(),expires=new Date(Date.now()+5*60_000);
 try{
  await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[subject]);
  const recent=await c.query("SELECT 1 FROM otp_challenges WHERE subject_hash=$1 AND created_at>now()-interval '60 seconds' LIMIT 1",[subject]);if(recent.rowCount)throw new Error("otp_rate_limited");
  const linked=await c.query("SELECT 1 FROM verified_contacts WHERE subject_hash=$1 AND account_id<>$2",[subject,accountId]);if(linked.rowCount)throw new Error("contact_already_linked");
  await c.query("INSERT INTO otp_challenges(id,channel,contact_type,account_id,subject_hash,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[id,channel,contactType,accountId,subject,mac(code),expires]);await c.query("COMMIT");
 }catch(e){await c.query("ROLLBACK").catch(()=>{});throw e}finally{c.release()}
 try{await sender.send(channel,destination,code)}catch(e){await pool.query("UPDATE otp_challenges SET consumed_at=now(),expires_at=now() WHERE id=$1 AND consumed_at IS NULL",[id]);throw e}
 return{id,expiresAt:expires.toISOString()}
}
export async function confirmOtp(id:string,destination:string,code:string,accountId:string,contactType:ContactType){
 const c=await pool.connect();try{await c.query("BEGIN");const q=await c.query("SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE",[id]);const r=q.rows[0];if(!r||r.consumed_at||new Date(r.expires_at).getTime()<Date.now()||r.attempts>=5||r.subject_hash!==mac(destination,contactType)||r.account_id!==accountId||r.contact_type!==contactType) {await c.query("ROLLBACK");return{verified:false,reason:"invalid_or_expired"}}
 const candidate=Buffer.from(mac(code)),saved=Buffer.from(r.code_hash);const ok=candidate.length===saved.length&&timingSafeEqual(candidate,saved);
 if(!ok){await c.query("UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1",[id]);await c.query("COMMIT");return{verified:false,reason:"invalid_or_expired"}}
 await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[r.subject_hash]);await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`account:${accountId}:${contactType}`]);const accountContact=await c.query("SELECT subject_hash FROM verified_contacts WHERE account_id=$1 AND channel=$2 FOR UPDATE",[accountId,contactType]);if(accountContact.rowCount&&accountContact.rows[0].subject_hash!==r.subject_hash){await c.query("ROLLBACK");return{verified:false,reason:"contact_already_set"}}const conflict=await c.query("SELECT account_id FROM verified_contacts WHERE subject_hash=$1 FOR UPDATE",[r.subject_hash]);if(conflict.rowCount&&conflict.rows[0].account_id!==accountId){await c.query("ROLLBACK");return{verified:false,reason:"contact_already_linked"}}
 await c.query("INSERT INTO verified_contacts(id,account_id,channel,subject_hash) VALUES($1,$2,$3,$4) ON CONFLICT(subject_hash) DO NOTHING",[randomUUID(),accountId,contactType,r.subject_hash]);await c.query("UPDATE otp_challenges SET consumed_at=now() WHERE id=$1",[id]);await c.query("COMMIT");return{verified:true}
 }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}}
export async function closeOtpPool(){await pool.end()}














