// Expo's default Metro config, plus spreadsheet files as bundled assets.
//
// The debt module ships a starter workbook (`assets/debt-import-sheet.xlsx`) that the
// import screen reads through the ordinary import pipeline, so the rows it creates are
// normal editable records — not data baked into the code.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'xlsx', 'csv'])];

module.exports = config;
