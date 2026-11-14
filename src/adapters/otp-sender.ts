import type { OtpSender } from "../core/verification.js";
/** Twilio Verify adapter. The local challenge stores a keyed digest; Twilio sends and also validates the same custom code. */
export class ConfiguredOtpSender implements OtpSender {
  private get credentials(){
    const service=process.env.TWILIO_VERIFY_SERVICE_SID,key=process.env.TWILIO_API_KEY,secret=process.env.TWILIO_API_SECRET;
    if(!service||!key||!secret)throw new Error("twilio_verify_not_configured");
    return{service,authorization:`Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`};
  }
  private async call(path:string,form:URLSearchParams){
    const {authorization}=this.credentials;
    const response=await fetch(`https://verify.twilio.com/v2/Services/${this.credentials.service}/${path}`,{method:"POST",headers:{authorization,"content-type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error(`twilio_verify_http_${response.status}`);
    return response.json() as Promise<{sid?:string;status?:string;valid?:boolean}>;
  }
  async send(channel:"email"|"sms"|"whatsapp",destination:string,code:string):Promise<void>{
    const result=await this.call("Verifications",new URLSearchParams({To:destination,Channel:channel,CustomCode:code}));
    if(!result.sid||result.status!=="pending")throw new Error("twilio_verify_invalid_start_response");
  }
  async check(_channel:"email"|"sms"|"whatsapp",destination:string,code:string):Promise<boolean>{
    const result=await this.call("VerificationCheck",new URLSearchParams({To:destination,Code:code}));
    return result.status==="approved"&&result.valid===true;
  }
}

