const fetch = jest.fn()

class Response {
    constructor(bodyStr, init) {
        this._bodyStr = bodyStr
        if (init) {
            this.status = init.status
            this.statusText = init.statusText
        }
    }
    json() {
        return JSON.parse(this._bodyStr)
    }
}
fetch.Response = Response
module.exports = fetch