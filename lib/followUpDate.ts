export function followUpDeadline(value:string){
 return new Date(value.length===10 ? value+"T23:59:59.999" : value);
}

export function formatFollowUp(dateTime:string,dateOnly?:string|null){
 if(dateOnly)return new Date(dateOnly+"T12:00:00").toLocaleDateString("es-MX",{dateStyle:"medium"});
 return new Date(dateTime).toLocaleString("es-MX",{dateStyle:"medium",timeStyle:"short"});
}
