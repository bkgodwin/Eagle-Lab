import https from 'node:https';

export function checkManagement(row, timeout = 5000) {
  return new Promise(resolve => {
    const started = Date.now();
    let finished = false, deadline;
    const finish = result => {
      if (finished) return;
      finished = true; clearTimeout(deadline);
      resolve({ ...result, checkedAt:new Date().toISOString(), latency:result.status === 'up' ? Date.now()-started : null });
    };
    const request = https.get({ hostname:row.ip, port:8006, path:'/api2/json/version', rejectUnauthorized:!row.allow_self_signed }, response => {
      response.resume();
      const httpStatus=response.statusCode;
      finish({ status:httpStatus>=200 && httpStatus<500 ? 'up' : 'down', httpStatus,
        statusReason:httpStatus>=200 && httpStatus<500
          ? `Management interface reachable (HTTP ${httpStatus}${[401,403].includes(httpStatus)?'; sign-in required':''}).`
          : `Management interface returned HTTP ${httpStatus}. The web service may be unhealthy.` });
    });
    deadline=setTimeout(()=>{ finish({status:'down',httpStatus:null,statusReason:`Connection to HTTPS port 8006 timed out after ${timeout/1000} seconds.`}); request.destroy(); },timeout);
    request.on('error',error=>{
      const code=error.code || 'CONNECTION_FAILED';
      let reason;
      if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER/.test(code)) reason=`TLS certificate validation failed (${code}). Check the node's certificate trust setting.`;
      else if (code==='ECONNREFUSED') reason='HTTPS port 8006 refused the connection from the portal host.';
      else if (['EHOSTUNREACH','ENETUNREACH'].includes(code)) reason='The portal host has no network route to this PVE address.';
      else reason=`Connection from the portal host failed (${code}). Check LAN routing and firewall access to port 8006.`;
      finish({status:'down',httpStatus:null,statusReason:reason});
    });
  });
}
