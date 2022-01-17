//jshint esversion:6

/* Environment and Library Definitions */

require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const saltRounds = 10;

//Set up express application settings

const app = express();

app.use(express.static("public"));
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({
    extended: true
}));

/* Mongo Database Definitions */

//const MongoClient = require('mongodb');
const uri = "mongodb+srv://" + process.env.DBADMIN + ":" + process.env.DBPASSWORD + "@cluster0.yqe4g.mongodb.net/biscit2DB?retryWrites=true&w=majority";
//const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

mongoose.connect(uri);

// Player collection
const playerSchema = new mongoose.Schema({
    //    uName: { type: String, required: [true], unique: true },  //User name all caps must be unique
    username: { type: String, required: [true] },  //User name all caps must be unique
    playername: { type: String, required: [true] },   //User name for display
    salt: { type: String },   //salt for hashing
    passhash: { type: String, select: true }, //Password hash or encrypt
    profile: String, //Player Profile Info
});

const Player = mongoose.model("player", playerSchema);

// Game collection
const gameSchema = new mongoose.Schema({
    player: { type: playerSchema, required: [true] }, //player of game
    gameNo: { type: Number, required: [true] }, //Number of games of player
    gameDate: Date,   //start date of game
    runningAvg: Number, //running average cash won per game prior to this one
    initialCases: String, //string version of available cases and amounts
    caseChosen: Number,   //number of case chosen
    caseAmount: Number,   //amount in case chosen
    cryptoStrategy: Number,  //Strategy used by CryptoBanker
    amountWon: Number,   //amount won in game
    casesSeen: Number,  //total number of cases seen before deal made
    selfPerformanceRating: Number,  //player self evaluation of how played game
});

const Game = mongoose.model("game", gameSchema);

// GameRound collection
const gameRoundSchema = new mongoose.Schema({
    game: { type: gameSchema, required: [true] },   //link to game id
    roundNo: { type: Number, required: [true] },   //round in game id
    availableCases: String,   //string version of available cases and amounts
    cryptoOffer: Number,       // Biscit offer by banker at that step
    offerAccepted: Boolean   //Whether offer accepted or not
});

const GameRound = mongoose.model("gameRound", gameRoundSchema);

/*
 * 
 Functions used throughout the application
 *
 */ 

//define box to choose from
function GCase(num, money) {   // object for game cases
    this.casenum = num;
    this.money = money;
}

function set_form_error(user_error, system_err) {
    if (user_error != null && user_error.length != 0) {
        console.log(user_error);
        if (system_err != null && system_err.length != 0) {
            console.log(system_err);
        }
        return user_error;
    } else {
        return null;
    }
}

// code from https://www.w3docs.com/snippets/javascript/how-to-randomize-shuffle-a-javascript-array.html
function shuffleArray(array) {
    let curId = array.length;
    // There remain elements to shuffle
    while (0 !== curId) {
        // Pick a remaining element
        let randId = Math.floor(Math.random() * curId);
        curId -= 1;
        // Swap it with the current element.
        let tmp = array[curId];
        array[curId] = array[randId];
        array[randId] = tmp;
    }
    return array;
}

const DEFAULTWIN = 0;
const startValues = [.01, 1, 5, 10, 25, 50, 75, 100, 200, 300, 400, 500, 750, 1000, 2500, 5000, 10000, 25000, 50000, 75000, 100000, 200000, 300000, 400000, 500000, 1000000];

var currentPlayer = null;
var currentGame = null;
var currentGameRound = null;
var form_error = null;

var selectedCase = new GCase(-1, -1);
var remaining_cases = [];   // array of all remaining cases
let r_until = -1;   //number of cases to choose until next offer
let r_offer = DEFAULTWIN;   // current crypto offer
let r_win = DEFAULTWIN;  // amount won in game
let r_canaccept = false;  //whether player can accept offer or not
let r_cases = [];  //array of remaining cases for display to user
let r_cash = []; //array of remaining cash values for display to user

// Specialized function to remove a case from the global remaining case array
function removeFromRemainingCaseArray(caseno) {
    let curId = 0;
    while (curId < remaining_cases.length && remaining_cases[curId].casenum != caseno) {
        curId++;
    }
    if (curId < remaining_cases.length) {
        remaining_cases.splice(curId, 1);
    } else {
        console.log("Error.  Failed to remove Case: " + caseno + " from remaining case array")
    }
}

function getCasesNumArray(case_array) {
    let num_array = [];
    for (let ix = 0; ix < case_array.length; ix++) {
       num_array.push(parseInt(case_array[ix].casenum));
    }
    num_array.sort(function (a, b) { return a - b });
    return num_array;
}

function getCasesCashArray(case_array, money) {

    let cash_array = [];
    for (let ix = 0; ix < case_array.length; ix++) {
        cash_array.push(case_array[ix].money);
    }
    cash_array.push(money);
    cash_array.sort(function (a, b) { return a - b });
    return cash_array;
}

function disableValuesCSS(startValues, remain_cash) {
    let retString = "";
    startValues.forEach(function (item) {
        if (remain_cash.indexOf(item) == -1) {
            let vid = "#v_" + item;
            if (item == .01) {
                vid = "#v_cent";
            }
            vid = vid + " {background-color: #444444;} "
            retString = retString + vid;
        }
    });
    return retString;
}

// somehow JQuery doesn't work with EJS
function disableCasesForSelection(remain_case) {
    let retString = "";
    for (let ix = 1; ix <= 26; ix++) {
        if (remain_case.indexOf(ix) == -1) {
            let dis_case = 'document.getElementById("case_' + ix + '").disabled = true; ';
            retString = retString + dis_case;
        }
    }
    retString = retString + 'document.getElementById("riskit").disabled = true; ';
    retString = retString + 'document.getElementById("biscit").disabled = true; ';
    return retString;
}

function disableCasesForRiskIt() {
    let retString = "";
    for (let ix = 1; ix <= 26; ix++) {
         let dis_case = 'document.getElementById("case_' + ix + '").disabled = true; ';
         retString = retString + dis_case;
    }
    return retString;
}

function getGameMessage(boolAccept, cases_until, cash_offer, num_cases_remaining) {
    if (num_cases_remaining == 1) {
        return "Click RiskIt to Keep the value in the original case; click BiscIt to take the Crypto Offer of $" + cash_offer;
    } else {
        if (boolAccept) {
            return "Click RiskIt to choose " + cases_until + " case(s) and see the next crypto offer; click BiscIt to take the Crypto Offer of $" + cash_offer;
        } else {
            return "Choose " + cases_until + " case(s) to see the next crypto offer."
        }
    }
}



function calc_new_until(nCases) {
    switch (nCases) {
        case 25:
            return 6;
        case 19:
            return 5;
        case 14:
            return 4;
        case 10:
            return 3;
        case 7:
            return 2;
        default:
            return 1;
    }
}

function calc_offer(array) {
    console.log(array);
    let sum = 0.0;
    for (let ix = 0; ix < array.length; ix++) {
        sum = sum + array[ix];
    }
    let pct = 95 - 3 * array.length + (array.length - 5) * Math.random();
    console.log(pct);
    console.log(sum);
    return Math.floor((pct * sum) / (array.length * 100));
   
}

/* 
 * App definitions
 */


app.get("/", function (req, res) {
    res.render("home");
});

app.get("/login", function (req, res) {
    res.render("login", { form_error: form_error });
});

app.get("/register", function (req, res) {
    res.render("register",{ form_error: form_error });
});

app.get("/endgame", function (req, res) {
    let gameId = currentGame._id;
    Game.updateOne({ _id: gameId },
        {
            amountWon: r_win,
            casesSeen: 25 - remaining_cases.length,
            selPerformanceRating: 3   //until we make rating possible
        },
        function (err) {
            if (err) {
                console.log("could not update game:" + currentGame);
            } else {
                res.render("endgame", {
                    r_player: currentPlayer,
                    amount_won: r_win,
                    case_chosen: selectedCase.casenum,
                    case_amount: selectedCase.money,
                    win_message: "Congratulations!  You won $" + r_win + " BISCiTs!"
                });
            }
        }
    );
});

app.get("/gamestart", function (req, res) {
    if (currentPlayer != null) {
            // Initalization of game

            let randomOrderValues = startValues;
            randomOrderValues = shuffleArray(randomOrderValues);

            remaining_cases = [];
            for (let ix = 1; ix <= 26; ix++) {
                remaining_cases.push(new GCase(ix, randomOrderValues[ix - 1]));
        }
        
        res.render("gamestart", { form_error: null });
    } else {
        res.redirect("/");
    }
});

app.get("/gameplay", function (req, res) {
    if (currentPlayer != null) {
        let disableButtonJS = "";
        if (r_until == 0) {
            disableButtonJS = disableCasesForRiskIt();
            r_canaccept = true;
            r_until = calc_new_until(r_cases.length);
            r_offer = calc_offer(r_cash);
        } else {
            disableButtonJS = disableCasesForSelection(r_cases);
            r_canaccept = false;
        }
        res.render("gameplay", {
            r_player: currentPlayer,
            case_chosen: selectedCase.casenum,
            r_cases: r_cases,
            r_cash: r_cash,
            r_until: r_until,
            r_canaccept: r_canaccept,
            bank_offer: r_offer,
            css_value_hide: disableValuesCSS(startValues, r_cash),
            disableButtonJS: disableButtonJS,
            game_message: getGameMessage(r_canaccept, r_until, r_offer, r_cases.length),
            r_game: currentGame
        });
    } else {
        res.redirect("/");
    }
});

app.get("/gamedata/player", function (req, res) {

    Game.find({ player: currentPlayer }, function (err, docs) {

        if (err) {
            console.log(err);
            console.log("No games found for " + currentPlayer);
        } else {

            let g_num = 0
            let g_avg = 0;
            let g_sum = 0.0;
            docs.forEach(function (item) {   // writing own logic since uncertain of use of calling mongoose aggregation
                g_sum += item.amountWon;
            });
            g_avg = g_sum / docs.length;
            g_num = docs.length;

            res.render("playerdata", {
                r_player: currentPlayer,
                r_gamesplayed: g_num,
                r_average: Math.round(g_avg),
                r_docs: docs
            });
        }
    });

});

app.get("/gamedata/high", function (req, res) {

    Game.find({}).sort('-amountWon').limit(20).exec(function (err, docs) {

        if (err) {
            console.log(err);
            console.log("No high score games found");
        } else {
            res.render("highdata", {
                r_docs: docs
            });
        }
    });
});


app.post("/register", function (req, res) {

    let pName = req.body.playername;
    let pUsername = pName.toUpperCase();
    let pSalt = pName.substring(1, 4) + (Math.floor(100 + 900 * Math.random())).toString();
    bcrypt.hash(req.body.password, saltRounds, function (err, pHash) {
        if (err) {
            form_error = set_form_error("No hashed password created for " + pUsername, err);
            res.redirect("/register");
        } else {
            let newPlayer = new Player({ username: pUsername, playername: pName, salt: pSalt, passhash: pHash });

            Player.findOne({ username: pUsername }, function (err, fUser) {
                if (err) {
                    form_error = set_form_error("Unknown error A during registration for " + pUsername, err);
                    res.redirect("/register");
                } else {
                    if (fUser != null) {
                        form_error = set_form_error("Username already exists: " + pUsername);
                        res.redirect("/register");
                    } else {
                        newPlayer.save(function (err) {
                            if (!err) {
                                console.log("Successly registered: " + newPlayer.username);
                                form_error = set_form_error(null); // successful registrartion so no error
                                currentPlayer = newPlayer;
                                res.redirect("/gamestart");
                            } else {
                                form_error = set_form_error("Unknown error B during registration for " + pUsername, err);
                                res.redirect("/register");
                            }
                        });
                    }
                }
            });
        }
    });
});

app.post("/login", function (req, res) {

    const pName = req.body.playername.toUpperCase();
    const pPass = req.body.password;

    Player.findOne({ username: pName }, function (err, fUser) {
        if (err) {
            form_error = set_form_error("Unknown error A during registration for " + pName, err);
            res.redirect("/login");
        } else {
            if (fUser === null) {
                form_error = set_form_error("User name does not exist: " + pName);
                res.redirect("/login");
            } else {
                bcrypt.compare(pPass, fUser.passhash, function (err, result) {  
                    if (result === true) {                                   // successful login
                        console.log("Successful login for: " + pName);
                        form_error = set_form_error(null);
                        currentPlayer = fUser;
                        res.redirect("/gamestart");
                    } else {
                        form_error = set_form_error("Password does not match for player " + pName);
                        res.redirect("/login");
                    }
                });
            }
        }
    });
});

app.post("/gamestart", function (req, res) {
    res.redirect("/gamestart");
});


/* Logic to handle the selection of each case.  Note that the logic to handle the first case being selected is also included */

app.post("/gameplay/:rm_caseno", function (req, res) { 
    const p_casenum = parseInt(req.params.rm_caseno);

    if (remaining_cases.length == startValues.length) {  //initial case chosen - new game created.  May move logic 

        console.log("Case chosen: " + p_casenum);
        selectedCase = remaining_cases[p_casenum - 1];

        r_gameno = 0;
        r_runavg = 0.0;

        Game.find({ player: currentPlayer }, function (err, docs) {

            if (err) {
                console.log(err);
                console.log("No games found for " + currentPlayer);
            } else {

                let g_num = -1;  //game number played
                let g_avg = 0;
                let g_sum = 0.0;
                docs.forEach(function (item) {   // writing own logic since uncertain of use of calling mongoose aggregation
                    g_sum += item.amountWon;
                });
                if (docs.length != 0) {
                    g_avg = g_sum / docs.length;
                    g_num = docs.length + 1;
                } else {
                    g_avg = 0;
                    g_num = 1
                }

                currentGame = new Game({
                    player: currentPlayer,
                    gameNo: g_num,
                    gameDate: new Date(Date.now()),   //get current date time,
                    runningAvg: g_avg,
                    initialCases: JSON.stringify(remaining_cases),
                    caseChosen: selectedCase.casenum,
                    caseAmount: selectedCase.money,
                    cryptoStrategy: 0,
                    amountWon: 0,
                    casesSeen: null,
                    selfPerformanceRating: null
                });

                currentGame.save(function (err) {
                    if (err) {
                        console.log("Could not save new game: " + currentGame);
                        console.log(err);
                    } else {    // if can actually save record then we start game
                        console.log("Saved new game: " + currentGame);
                        r_gameno = currentGame.gameNo;
                        r_runavg = currentGame.runningAvg;
                        removeFromRemainingCaseArray(p_casenum);
                        r_cases = getCasesNumArray(remaining_cases)
                        r_cash = getCasesCashArray(remaining_cases, selectedCase.money);
                        r_until = calc_new_until(r_cases.length);
                        r_win = DEFAULTWIN;
                        r_offer = 0;
                        res.redirect("/gameplay");
                    }
                });
            }
        });

    } else {
        console.log("Removing case: " + p_casenum);
        removeFromRemainingCaseArray(p_casenum);   
        r_cases = getCasesNumArray(remaining_cases)
        r_cash = getCasesCashArray(remaining_cases, selectedCase.money);
        r_until = r_until - 1;
        res.redirect("/gameplay");
    }
 
});

app.post("/gamedecide/riskit", function (req, res) {
    if (r_cases.length > 1) {    //keep it going
        res.redirect("/gameplay");
    } else {                    //go with the value in the final case
        r_win = selectedCase.money;  //the offer is the value in the case if get to the end
        res.redirect("/endgame");
    }
});

app.post("/gamedecide/biscit", function (req, res) {  //take the banker offer
    r_win = r_offer;
    res.redirect("/endgame");
});


app.post("/gamedata/player", function (req, res) {
    res.redirect("/gamedata/player");
});

app.post("/gamedata/high", function (req, res) {
    res.redirect("/gamedata/high");
});


app.listen(3000, function () {
    console.log("Server started on port 3000.");
});
