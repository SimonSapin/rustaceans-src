// A simple web server providing a RESTful API for Rustaceans data. Allows
// getting a single user or searching for users.

// start with `nohup nodejs rustaceans.js &`

var http = require('http');
var url = require('url');
var sqlite = require('sqlite3');
var async = require('async');

var config = require('./config.json');

var daemon = require('./daemon.js');

// Start up our server listening on port 2345.
http.createServer(function (req, res) {
    var parsed_url = url.parse(req.url, true);
    var pathname = parsed_url.pathname;
    if (pathname == '/user') {
        get_user(parsed_url.query['username'] , res);
    } else if (pathname == '/search') {
        search(parsed_url.query['for'] , res);
    } else if (pathname == '/pr') {
        // Get payload and parse it
        var body = '';
        req.on('data',function(chunk){
            body+=chunk;
        });
        req.on('end',function(){
            try {
                var json = JSON.parse(body);
                daemon.process_pr(json);
                res.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"});
                res.end("Success?");
            } catch(e) {
                res.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"});
                res.end("Error: " + e);
            }
        });
    } else {
        res.writeHead(404, {"Content-Type": "text/plain"});
        res.write("404 Not Found\n");
        res.end();
      }
}).listen(2345);

function get_channels(username, res, db, callback) {
    db.all('SELECT * FROM people_channels WHERE person=?;', username, function(err, rows) {
        if (err) {
            console.log("an error occured searching for irc channels for " + username + ": " + err);
            make_response(res, []);
            return;
        }

        callback(rows);
    });
}

// Search for users, returns a possibly empty array of user json objects.
function search(search_str, res) {
    var db = new sqlite.Database("rustaceans.db");
    db.all("SELECT * FROM people WHERE blob LIKE '%" + search_str + "%';", function(err, rows) {
        if (err) {
            console.log("an error occured whilst searching for '" + search_str + "': " + err);
            make_response(res, []);
            return;
        }

        // This nasty bit of callback hell is for finding each users irc channels.
        // For each user we look up the channels from the DB, then create the user object.
        // Once we have all the user objects in an array, then we put them in the repsonse.
        async.parallel(rows.map(function(row) {
            return function(callback) {
                get_channels(row.username, res, db, function(rows) {
                    callback(null, make_user(row, rows));
                })
            };
        }),
        function(err, result) {
            make_response(res, result);
        });
    });
    db.close();
}

// Return a info for a single user. Returns either a single user JSON object or
// an empty JSON object if there is no such user.
function get_user(username, res) {
    // Check the db for the user.
    var db = new sqlite.Database("rustaceans.db");
    db.get('SELECT * FROM people WHERE username=?;', username, function(err, row) {
        if (err || !row) {
            console.log("an error occured searching for user " + username + ": " + err);
            make_response(res, []);
            return;
        }

        get_channels(username, res, db, function(rows) {
            make_response(res, [make_user(row, rows)]);
        });
    });
    db.close();
}

// Turn data into JSON and add it to the response
function make_response(response, data) {
    response.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "http://www.rustaceans.org"});
    response.end(JSON.stringify(data));
}

// Does not include username.
// Fields that can be directly copied to the user object from the DB.
var fields = [
    "username",
    "name",
    "irc",
    "email",
    "discourse",
    "reddit",
    "twitter",
    "blog",
    "website",
    "notes"
];


// Take rows from the db and make a JS object representing the user.
function make_user(user_row, channel_rows) {
    var user = {};

    fields.forEach(function(f) {
        user[f] = user_row[f];
    });

    if (user_row.show_avatar) {
        user['avatar'] = 'https://avatars.githubusercontent.com/' + user_row['username'];
    }

    if (channel_rows) {
        user['irc_channels'] = channel_rows.map(function(cr) { return cr.channel; });
    } else {
        user['irc_channels'] = [];
    }
    return user;
}
