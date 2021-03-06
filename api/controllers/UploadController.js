/**
 * UploadsController
 *
 * @description :: Server-side logic for managing uploads
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {

    opml: function(req, res) {

        const fs     = require('fs'),
              urlLibrary = require('url'),
              parser = require('node-opml-parser')

        req.file('opml').upload(function (err, files) {

            if (err) return res.serverError(err)

            let opml = fs.readFileSync(files[0].fd, 'utf8'),
                urls = []

            parser(opml, (err, feeds) => {

                if (err) return res.serverError(err)

                urls = feeds.map(feed => {
                    return feed.feedUrl
                })

                function addFeed(feedUrl, cb) {

                    sails.log.info(`starting to add url`, feedUrl)

                    parse.fetch(feedUrl, function(err, rssMeta, articles) {

                        if (err) {
                            sails.log.warn('failed to add feed', err)
                            // we dont break if 1 feed breaks
                            return cb(null, null)
                        }

                        const hostname = urlLibrary.parse(feedUrl).hostname

                        let rssLinkHostname

                        if (rssMeta.link) rssLinkHostname = urlLibrary.parse(rssMeta.link).hostname

                        let siteUrl = rssLinkHostname || hostname,
                            name    = rssMeta.title

                        if (name && name.indexOf('RSS') != -1) name = null

                        async.waterfall([

                            function(callback) {

                                Sites.findOrCreate({
                                    siteUrl: siteUrl
                                }, {
                                    siteUrl: siteUrl,
                                    name: name
                                }).exec(callback)

                            },
                            function(site, callback) {

                                Feeds.findOrCreate({
                                    feedUrl: feedUrl
                                }, {
                                    site: site.id,
                                    siteUrl: hostname,
                                    feedUrl: feedUrl
                                }).exec(callback)

                            },
                            // TODO: Maybe refactor this to use the follow service
                            function(feed, seriesCallback) {

                                async.parallel([

                                    callback => {

                                        sails.models.follows.findOrCreate({
                                            type: 'feed',
                                            feed: feed.id,
                                            user: req.user.id
                                        }).exec(callback)

                                    },

                                    callback => {

                                        let timelineFeed = StreamService.client.feed('timeline', req.user.id)

                                        timelineFeed.follow('rss_feed', feed.id)
                                            .then(response => {
                                                callback(null, response)
                                            }).catch(err => {
                                                callback(err)
                                            })

                                    }

                                ], seriesCallback)

                            }

                        ], function(err, results) {

                            if (err) {
                                sails.log.warn(`Failed to add feed`, err)
                            }

                            sails.log.info(`Completed adding url`, feedUrl)

                            // dont halt import if there is an error with 1 feed
                            return cb(null, results)

                        })

                    })
                }

                async.map(urls, addFeed, function(err, results) {
                    if (err) {
                        return res.badRequest('Sorry, failed to parse OPML import.')
                    } else {
                        return res.ok({urls: urls})
                    }
                })

            })


        })

    },

}
