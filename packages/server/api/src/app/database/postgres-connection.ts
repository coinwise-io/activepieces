import { TlsOptions } from 'node:tls'
import { isNil, spreadIfDefined } from '@activepieces/core-utils'
import 'pg'
import { DataSource } from 'typeorm'
import { system } from '../helper/system/system'
import { AppSystemProp } from '../helper/system/system-props'
import { BackgroundMigration } from './background-migration'
import { commonProperties } from './database-connection'
import { Migration } from './migration'
import { InitialSchema1879000000000 } from './migration/postgres/1879000000000-InitialSchema'
import { AddIdentityProvisioning1880000000000 } from './migration/postgres/1880000000000-AddIdentityProvisioning'
import { AddUserMfa1880000000001 } from './migration/postgres/1880000000001-AddUserMfa'

const getSslConfig = (): boolean | TlsOptions => {
    const useSsl = system.get(AppSystemProp.POSTGRES_USE_SSL)
    if (useSsl === 'true') {
        return {
            ca: system.get(AppSystemProp.POSTGRES_SSL_CA)?.replace(/\\n/g, '\n'),
        }
    }
    return false
}

export const getBackgroundMigrations = (): (new () => BackgroundMigration)[] => {
    return []
}

export const getMigrations = (): (new () => Migration)[] => {
    return [
        InitialSchema1879000000000,
        AddIdentityProvisioning1880000000000,
        AddUserMfa1880000000001,
    ]
}


export const createPostgresDataSource = (): DataSource => {
    const migrationConfig: MigrationConfig = {
        migrationsRun: false,
        migrationsTransactionMode: 'each',
        migrations: getMigrations(),
        synchronize: false,
    }

    const url = system.get(AppSystemProp.POSTGRES_URL)

    if (!isNil(url)) {
        return new DataSource({
            type: 'postgres',
            url,
            ssl: getSslConfig(),
            ...spreadIfDefined('poolSize', system.get(AppSystemProp.POSTGRES_POOL_SIZE)),
            ...migrationConfig,
            ...commonProperties,
        })
    }

    const database = system.getOrThrow(AppSystemProp.POSTGRES_DATABASE)
    const host = system.getOrThrow(AppSystemProp.POSTGRES_HOST)
    const password = system.getOrThrow(AppSystemProp.POSTGRES_PASSWORD)
    const serializedPort = system.getOrThrow(AppSystemProp.POSTGRES_PORT)
    const port = Number.parseInt(serializedPort, 10)
    const idleTimeoutMillis = system.getNumberOrThrow(AppSystemProp.POSTGRES_IDLE_TIMEOUT_MS)
    const username = system.getOrThrow(AppSystemProp.POSTGRES_USERNAME)

    return new DataSource({
        type: 'postgres',
        host,
        port,
        username,
        password,
        database,
        ssl: getSslConfig(),
        ...spreadIfDefined('poolSize', system.get(AppSystemProp.POSTGRES_POOL_SIZE)),
        ...commonProperties,
        ...migrationConfig,
        extra: {
            idleTimeoutMillis,
        },
    })
}

export const createPostgresMigrationDataSource = (): DataSource | null => {
    const url = system.get(AppSystemProp.POSTGRES_MIGRATION_URL)
    if (isNil(url)) return null
    return new DataSource({
        type: 'postgres',
        url,
        ssl: getSslConfig(),
        poolSize: 2,
        migrationsRun: false,
        synchronize: false,
        ...commonProperties,
    })
}

type MigrationConfig = {
    migrationsRun?: boolean
    migrationsTransactionMode?: 'all' | 'none' | 'each'
    migrations?: (new () => Migration)[]
    synchronize: false
}
