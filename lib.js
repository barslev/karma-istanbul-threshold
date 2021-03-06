'use strict';

const chalk = require('chalk');
const _ = require('lodash');
const fs = require('fs');
const istanbul = require('istanbul');
const utils = require('istanbul/lib/object-utils');
const path = require('path');
const minimatch = require('minimatch');

const TYPES = ['lines', 'statements', 'functions', 'branches'];

const defaultThresholds = {
  global: {
    statements: 0,
      branches: 0,
      lines: 0,
      functions: 0,
  },
  each: {
    statements: 0,
      branches: 0,
      lines: 0,
      functions: 0,
  }
};

const checkCoverage = function (
  json, log, config
) {
  const thresholds = _.assign({}, defaultThresholds, config.thresholds);
  const basePath = config.basePath || '';
  const reporters = config.reporters || ['text'];
  const excludes = config.excludes || [];
  const colors = config.colors !== false;

  chalk.enabled = colors;

  let failed = false;

  const checkThreshold = function(threshold, summary) {
    const result = { failed: false };

    // Check for no threshold
    if (!threshold) {
      result.skipped = true;
      return result;
    }

    // Check percentage threshold
    if (threshold > 0) {
      result.value = summary.pct;
      result.failed = result.value < threshold;
    }
    // Check gap threshold
    else {
      result.value = summary.covered - summary.total;
      result.failed = result.value < threshold;
    }

    return result;
  };

  const checkThresholds = function(thresholds, summary) {
    return TYPES.map(function(type) {
      // If the threshold is a number use it, otherwise lookup the threshold type
      const threshold = typeof thresholds === 'number' ? thresholds : thresholds && thresholds[type];
      return checkThreshold(threshold, summary[type]);
    });
  };

  const formatFilename = function(filename) {
    if (!filename) {
      return filename;
    }

    let pathComponents = filename.split(/[\/\\]/);
    pathComponents[pathComponents.length - 1] = chalk.yellow(_.last(pathComponents));
    return pathComponents.join('/');
  }

  const recordFailure = function (scope, type, value, filename) {
    failed = true;
    const expected = thresholds[scope][type];
    if (filename) {
      filename = path.relative(basePath, filename);
    }
    filename = scope === 'global' ? 'GLOBAL' : filename;

    if (reporters.indexOf('text') !== -1) {
      log(
        chalk.red.bold('Low Coverage: ')
        + formatFilename(filename) + ' '
        + chalk.bold(value + '%') + ' of '
        + chalk.bold(expected + '% ')
        + chalk.bold(type)
        + '\n'
      );
    }

    if (reporters.indexOf('teamcity') !== -1) {
      const message = 'Low Coverage: ' + filename + ' ' + value + '% of ' + expected + '% ' + type;
      log("##teamcity[buildProblem description='" + message + "' identity='lowCodeCoverage']\n")
    }
  };

  const checkFailures = function(thresholds, coverage) {
    const summary = TYPES.map(function(type) {
      return { type: type };
    });

    // If there are global thresholds check overall coverage
    if (thresholds.global) {
      const global = checkThresholds(thresholds.global, utils.summarizeCoverage(coverage));
      // Inject into summary
      summary.map(function(metric, i) {
        metric.global = global[i];
        if (global[i].failed) {
          recordFailure('global', metric.type, metric.global.value);
        }
      });
    }

    // If there are individual thresholds check coverage per file
    if (thresholds.each) {
      _.each(coverage, function(fileCoverage, filename) {
        // Check failures for a file
        const each = checkThresholds(
          thresholds.each,
          utils.summarizeFileCoverage(fileCoverage)
        );
        _.map(each, function(item, i) {
          if (item.failed) {
            recordFailure('each', TYPES[i], item.value, filename);
          }
        });
      });
    }

    return summary;
  };

  // filter config.excludes
  _.forEach(excludes, function (exclude) {
    _.forEach(json, function (value, key) {
      if (minimatch(key, path.join(basePath, exclude).replace('//', '/'))) {
        delete(json[key]);
      }
    });
  });

  const collector = new istanbul.Collector();
  collector.add(json);

  const coverage = collector.getFinalCoverage();
  checkFailures(thresholds, coverage);

  collector.dispose();

  return failed ? 1 : 0;
};

module.exports = {
  checkCoverage
};
