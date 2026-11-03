module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    overrides: [
      {
        test: (filename) => Boolean(
          filename && /node_modules[\\/]@react-native[\\/]jest-preset[\\/]jest[\\/]setup\.js$/.test(filename),
        ),
        presets: [['@babel/preset-typescript', { ignoreExtensions: true }]],
      },
    ],
  };
};
