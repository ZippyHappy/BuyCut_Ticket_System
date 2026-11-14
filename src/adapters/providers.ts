export interface IdentityProvider { createSession(input:{accountId:string;returnUrl:string}):Promise<{sessionId:string;url:string}>; getResult(sessionId:string):Promise<{status:"pending"|"verified"|"rejected";documentToken?:string;faceMatch?:boolean;reason?:string}> }
export interface RiskSignals { networkType:"residential"|"mobile"|"hosting"|"unknown"; country?:string; region?:string; sharedIpPurchases:number; vpnOrProxy:boolean }
export interface RiskProvider { inspect(ip:string):Promise<RiskSignals> }

