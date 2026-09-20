'use strict';
const {version}=require('../backend-v2/src/modules/legal/documents');
// The operator must review this checkout's texts for the synthetic test accounts
// and explicitly set OPS_LEGAL_CONSENT_VERSION. This never authorizes production use.
module.exports=function operationalConsent(){
  if(process.env.OPS_LEGAL_CONSENT_VERSION!==version){
    throw new Error(`BLOCKED: review policy documents and explicitly set OPS_LEGAL_CONSENT_VERSION=${version} for authorized test accounts`);
  }
  return {accepted:true,privacyVersion:version,termsVersion:version};
};
