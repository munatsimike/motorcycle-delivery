const { withAppBuildGradle } = require('expo/config-plugins');

const INSTALL = "installOptions '--user', '0'";

function withOwnerInstall(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy' || config.modResults.contents.includes(INSTALL)) {
      return config;
    }
    config.modResults.contents = config.modResults.contents.replace(
      /android\s*\{/,
      `android {\n    installation {\n        ${INSTALL}\n    }\n`,
    );
    return config;
  });
}

module.exports = withOwnerInstall;
