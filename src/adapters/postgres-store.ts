import { Pool } from "pg";
import { createHmac,randomUUID } from "node:crypto";
import type {Evaluation,EvaluationInput} from "../core/types.js";
if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required");
const pool=new Pool({connectionString:process.env.DATABASE_URL, max:10, ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:true}:undefined});
const secret=process.env.BUYCUT_HASH_SECRET??"";if(secret.length<32||secret.includes("replace-with"))throw new Error("BUYCUT_HASH_SECRET must be a unique random secret of at least 32 chars");
const canonical=(v:string)=>v.trim().toLowerCase();
const hash=(v:string)=>createHmac("sha256",secret).update(canonical(v)).digest("hex");
const hashPhone=(v:string)=>createHmac("sha256",secret).update(v.replace(/\D/g,"")).digest("hex");
const hashSignal=(kind:string,value:string)=>{
 const normalized=kind==="email"?value.trim().toLowerCase():kind==="phone"?value.replace(/\D/g,""):kind==="account"?value.trim():value;
 return createHmac("sha256",secret).update(normalized).digest("hex");
};
const TTL=10*60_000,LIMIT=4;
export async function evaluate(input:EvaluationInput):Promise<Evaluation>{
 const {buyer,eventId,quantity,ip}=input;if(!buyer.documentToken)return{id:"",decision:"review",reasonCodes:["identity_verification_required"],expiresAt:new Date(Date.now()+TTL).toISOString()};
 if(!buyer.accountId.trim()||!buyer.email.trim()||!buyer.phone.trim()||!buyer.paymentToken.trim())return{id:"",decision:"review",reasonCodes:["buyer_signals_incomplete"],expiresAt:new Date(Date.now()+TTL).toISOString()};
 const fields:[string,string][]=[["account",buyer.accountId],["email",buyer.email],["phone",buyer.phone],["document",buyer.documentToken],["payment",buyer.paymentToken],["ip",ip]];
 const c=await pool.connect();try{await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[eventId]);await c.query("DELETE FROM purchase_reservations WHERE expires_at<=now() AND status='reserved'");
 for(const [kind,value] of fields){const signalHash=hashSignal(kind,value);const {rows}=await c.query("SELECT COALESCE(SUM(s.quantity),0)::int AS n FROM reservation_signals s JOIN purchase_reservations r ON r.id=s.reservation_id WHERE s.event_id=$1 AND s.signal_type=$2 AND s.signal_hash=$3 AND (r.status='committed' OR (r.status='reserved' AND r.expires_at>now()))",[eventId,kind,signalHash]);if(Number(rows[0].n)+quantity>LIMIT){await c.query("ROLLBACK");return{id:"",decision:kind==="ip"?"review":"block",reasonCodes:[kind==="ip"?"shared_ip_velocity":"purchase_limit_exceeded"],expiresAt:new Date(Date.now()+TTL).toISOString()}}}
 const id=randomUUID(),expires=new Date(Date.now()+TTL);await c.query("INSERT INTO purchase_reservations(id,event_id,quantity,status,expires_at) VALUES($1,$2,$3,'reserved',$4)",[id,eventId,quantity,expires]);for(const [kind,value] of fields)await c.query("INSERT INTO reservation_signals(reservation_id,event_id,signal_type,signal_hash,quantity) VALUES($1,$2,$3,$4,$5)",[id,eventId,kind,hashSignal(kind,value),quantity]);await c.query("COMMIT");return{id,decision:"allow",reasonCodes:[],expiresAt:expires.toISOString()}
 }catch(e){await c.query("ROLLBACK").catch(()=>{});if((e as {code?:string}).code==="40001")return{id:"",decision:"review",reasonCodes:["concurrent_retry"],expiresAt:new Date(Date.now()+TTL).toISOString()};throw e}finally{c.release()}}
export async function commit(id:string,quantity:number){const {rowCount}=await pool.query("UPDATE purchase_reservations SET status='committed' WHERE id=$1 AND quantity=$2 AND status='reserved' AND expires_at>now()",[id,quantity]);return rowCount===1}
export async function release(id:string){const {rowCount}=await pool.query("UPDATE purchase_reservations SET status='released' WHERE id=$1 AND status='reserved'",[id]);return rowCount===1}
export async function closePool(){await pool.end()}



export async function areContactsVerified(accountId:string,email:string,phone:string){
 const emailHash=hash(email.trim().toLowerCase()),phoneHash=hashPhone(phone);
 const {rows}=await pool.query("SELECT channel,subject_hash FROM verified_contacts WHERE account_id=$1 AND ((channel='email' AND subject_hash=$2) OR (channel='phone' AND subject_hash=$3))",[accountId,emailHash,phoneHash]);
 return rows.some((r:{channel:string})=>r.channel==='email')&&rows.some((r:{channel:string})=>r.channel==='phone');
}
export async function isIdentityVerified(accountId:string,documentToken:string){
 const documentHash=hash(documentToken);
 const {rowCount}=await pool.query("SELECT 1 FROM verified_identities WHERE account_id=$1 AND document_hash=$2 AND face_match=true AND expires_at>now()",[accountId,documentHash]);
 return rowCount===1;
}



export async function checkDatabase(){await pool.query("SELECT 1");return true}


