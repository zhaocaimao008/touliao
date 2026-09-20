'use strict';
// Explicit fixture for pre-existing authentication tests. Refusal cases in F-07
// deliberately omit/alter this payload; no request interception is used.
const { version } = require('../src/modules/legal/documents');
module.exports = { accepted: true, privacyVersion: version, termsVersion: version };
