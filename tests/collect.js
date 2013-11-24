var _       = require('lodash-node');
var async   = require('async');
var request = require('request');
var greppy  = require('greppy');

// Specific config
var config   = greppy.config.get('app');
var services = config.get('services');
var bitcoinAddress = config.get('bitcoin').address;

// Build a usefull set of information of multiple sources
async.parallel([

    // Fetch the all balances of the pool
    function(callback) {

        request(services.poolBalances.url, function(err, res, body) {

            if (err || 200 !== res.statusCode) {
                return callback && callback(
                    err || new Error('Pool balances response code not 200')
                );
            }

            try {

                var balance = JSON.parse(body)[bitcoinAddress];

                // Just a hint for the gc
                res  = null;
                body = null;

                return callback && callback(null, balance);

            } catch (e) {
                return callback && callback(
                    err || new Error('Exchange response not parseable')
                );
            }
        });
    },

    // Fetch current exchange for USD to EUR
    function(callback) {

        request(services.exchangeUSDToEUR.url, function(err, res, body) {

            if (err || 200 !== res.statusCode) {
                return callback && callback(
                    err || new Error('Exchange response code not 200')
                );
            }

            try {
                return callback && callback(null, JSON.parse(body));
            } catch (e) {
                return callback && callback(
                    err || new Error('Exchange response not parseable')
                );
            }
        });
    },

    // Fetch stats for the configured bitcoin address
    function(callback) {

        request(services.poolStats.url + bitcoinAddress, function(err, res, body) {

            if (err || 200 !== res.statusCode) {
                return callback && callback(
                    err || new Error('Pool stats response code not 200')
                );
            }

            try {

                var raw = JSON.parse(body);
                delete raw.intervals;
                var stats = _.values(raw);

                return callback && callback(null, stats);

            } catch (e) {
                return callback && callback(
                    err || new Error('Pool stats response not parseable')
                );
            }
        });
    }

], function(err, results) {

    if (err) {
        return console.log(err);
    }

    // Just remap for readable properties
    results = _.zipObject(['balance', 'exchange', 'stats'], results);

    // Fetch calculation of bitcoins by stats of hashrates
    async.map(results.stats, function(item, callback) {

        // Cut off unneeded information
        delete item.interval_name;

        // Skip zero hashrates
        if (0 === item.hashrate) {

            return callback && callback(null, _.assign(item, {
                dollarsPerHour: 0,
                dollarsPerInterval: 0,
                eurosPerHour: 0,
                eurosPerInterval: 0,
                coinsPerHour: 0
            }));
        }

        request(services.btcCalculator.url + '?hashrate=' + item.hashrate,
            function(err, res, body) {

            if (err || 200 !== res.statusCode) {
                return callback && callback(
                    err || new Error('BTC calculation response code not 200')
                );
            }

            try {

                var calc = JSON.parse(body);
                var intervalHours = item.interval / 3600;

                var dollars = {
                    dollarsPerHour: calc.dollars_per_hour,
                    dollarsPerInterval: calc.dollars_per_hour * intervalHours
                };

                var euros = {
                    eurosPerHour: dollars.dollarsPerHour * results.exchange.rate,
                    eurosPerInterval: dollars.dollarsPerInterval * results.exchange.rate
                };

                var result = _.assign(item, dollars, euros, {
                    coinsPerHour: calc.coins_per_hour
                });

                return callback && callback(null, result);

            } catch (e) {
                return callback && callback(
                    err || new Error('BTC calculation response not parseable')
                );
            }
        })

    }, function(err, stats) {

        if (err) {
            return console.log(err);
        }

        results.stats = stats;

        console.log(JSON.stringify(results, null, '    '));
    });
});

