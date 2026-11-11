// Release profile: never silently produce an unsigned public installer.
// Supply signing credentials through WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD
// (or CSC_LINK / CSC_KEY_PASSWORD). Do not store credentials in this file.
const { build } = require('./package.json');
module.exports = {
  ...build,
  forceCodeSigning: true,
  win: {
    ...build.win,
    ...(process.env.SNIPAI_CERTIFICATE_SUBJECT ? {
      signtoolOptions: { certificateSubjectName: process.env.SNIPAI_CERTIFICATE_SUBJECT }
    } : {})
  }
};
