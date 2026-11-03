// Spreadsheets are bundled as Metro assets (see metro.config.js), so `require()` on one
// resolves to an asset module id rather than a typed value.
declare module '*.xlsx' {
  const asset: number;
  export default asset;
}
