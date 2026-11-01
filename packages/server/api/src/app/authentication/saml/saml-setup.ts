import * as validator from '@authenio/samlify-node-xmllint'
import * as samlify from 'samlify'

let validatorInstalled = false

function ensureSchemaValidator(): void {
    if (validatorInstalled) {
        return
    }
    samlify.setSchemaValidator(validator)
    validatorInstalled = true
}

export const samlSetup = {
    ensureSchemaValidator,
}
