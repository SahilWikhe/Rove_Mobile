// Auth0 post-login Action source. Configure ROVE_API_AUDIENCE as an Action secret.
// No Management API credential or user-controlled metadata is involved.
exports.onExecutePostLogin = async (event, api) => {
  const audience = event.secrets.ROVE_API_AUDIENCE;
  if (!audience || event.resource_server?.identifier !== audience) return;
  api.accessToken.setCustomClaim('https://roveride.co/email_verified', event.user.email_verified === true);
};
