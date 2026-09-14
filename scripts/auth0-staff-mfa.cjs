// Staff acceptance client only. Bind before auth0-mfa-claim.cjs.
exports.onExecutePostLogin = async (event, api) => {
  const client = event.secrets.ROVE_STAFF_CLIENT_ID;
  if (!client || event.client?.client_id !== client) return;
  const audience = event.secrets.ROVE_API_AUDIENCE;
  if (!audience || event.resource_server?.identifier !== audience) {
    api.access.deny('Staff sign-in requires the configured Rove API audience.');
    return;
  }
  if (event.transaction?.protocol === 'oauth2-refresh-token') {
    api.access.deny('Sign in again to complete staff verification.');
    return;
  }
  const factors = event.user.enrolledFactors;
  if (Array.isArray(factors) && factors.some((factor) => factor?.type === 'otp')) {
    api.authentication.challengeWith({ type: 'otp' });
  } else {
    api.authentication.enrollWith({ type: 'otp' });
  }
};
