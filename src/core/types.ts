export type Decision="allow"|"review"|"block";
export interface BuyerSignals{accountId:string;email:string;phone:string;documentToken:string;paymentToken:string;networkType?:"residential"|"mobile"|"hosting"|"unknown";locationCountry?:string}
export interface EvaluationInput{eventId:string;buyer:BuyerSignals;quantity:number;ip:string}
export interface Evaluation{id:string;decision:Decision;reasonCodes:string[];expiresAt:string}

