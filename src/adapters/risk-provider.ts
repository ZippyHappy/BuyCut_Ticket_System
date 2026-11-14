export interface RiskSignals { networkType:"residential"|"mobile"|"hosting"|"unknown"; country?:string; region?:string; sharedIpPurchases:number; vpnOrProxy:boolean }
export class ConfiguredRiskProvider {
 async inspect(ip:string):Promise<RiskSignals>{
  const url=process.env.RISK_PROVIDER_URL,token=process.env.RISK_PROVIDER_TOKEN;if(!url||!token)throw new Error("risk_provider_not_configured");
  const endpoint=new URL(url);endpoint.searchParams.set("ip",ip);
  const res=await fetch(endpoint,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});if(!res.ok)throw new Error("risk_provider_failed");
  const v=await res.json() as Partial<RiskSignals>;if(!["residential","mobile","hosting","unknown"].includes(String(v.networkType))||typeof v.vpnOrProxy!=="boolean"||typeof v.sharedIpPurchases!=="number")throw new Error("risk_provider_invalid_response");
  return{networkType:v.networkType as RiskSignals["networkType"],vpnOrProxy:v.vpnOrProxy,sharedIpPurchases:Math.max(0,Math.floor(v.sharedIpPurchases)),country:typeof v.country==="string"?v.country.slice(0,2):undefined,region:typeof v.region==="string"?v.region.slice(0,64):undefined};
 }
}

