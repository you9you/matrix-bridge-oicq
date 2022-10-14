const util = require('util');
module.exports = function (text, ...param) {
    return util.format(text, ...param);
}