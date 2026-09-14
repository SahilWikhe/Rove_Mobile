// Bind after the staff MFA challenge Action. Never infer completion from a request,
// enrollment, user metadata, or calling multifactor.enable().
exports.onExecutePostLogin = async (event, api) => {
  const audience = event.secrets.ROVE_API_AUDIENCE;
  if (!audience || event.resource_server?.identifier !== audience) return;
  const methods = event.authentication?.methods;
  const verified = Array.isArray(methods) && methods.some((method) => method?.name === 'mfa');
  api.accessToken.setCustomClaim('https://roveride.co/mfa', verified);
};
