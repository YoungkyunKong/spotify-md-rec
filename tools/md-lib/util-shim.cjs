// netmd-js only uses util.inspect for debug log payloads.
module.exports = {
  inspect: (value) => value,
  TextDecoder: globalThis.TextDecoder,
  TextEncoder: globalThis.TextEncoder,
};
