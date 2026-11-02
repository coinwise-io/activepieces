import { isNil } from '@activepieces/core-utils'
import {
    DataSource,
    EntitySchema,
} from 'typeorm'
import { AIProviderEntity } from '../ai/ai-provider-entity'
import { AiToolConfigEntity } from '../ai/ai-tool-config-entity'
import { PlatformModelTierEntity } from '../ai/platform-model-tier-entity'
import { AiUsage5mEntity, AiUsageCopyCursorEntity, AiUsageDailyEntity, AiUsageRunEntity } from '../ai/usage/ai-usage-entities'
import { PlatformAnalyticsReportEntity } from '../analytics/platform-analytics-report.entity'
import { AppConnectionEntity } from '../app-connection/app-connection.entity'
import { UserMfaEntity } from '../authentication/mfa/user-mfa.entity'
import { OtpEntity } from '../authentication/otp/otp-entity'
import { UserIdentityEntity } from '../authentication/user-identity/user-identity-entity'
import { EventDestinationEntity } from '../event-destinations/event-destinations.entity'
import { FileEntity } from '../file/file.entity'
import { FlagEntity } from '../flags/flag.entity'
import { FlowEntity } from '../flows/flow/flow.entity'
import { FlowRunEntity } from '../flows/flow-run/flow-run-entity'
import { FlowVersionEntity } from '../flows/flow-version/flow-version-entity'
import { FolderEntity } from '../flows/folder/folder.entity'
import { system } from '../helper/system/system'
import { AppSystemProp } from '../helper/system/system-props'
import { ScimTokenEntity } from '../identity-provisioning/scim-token/scim-token.entity'
import { UserGroupMemberEntity } from '../identity-provisioning/user-group/user-group-member.entity'
import { UserGroupEntity } from '../identity-provisioning/user-group/user-group.entity'
import { KnowledgeBaseChunkEntity } from '../knowledge-base/knowledge-base-chunk.entity'
import { KnowledgeBaseFileEntity } from '../knowledge-base/knowledge-base-file.entity'
import { McpActivityEntity } from '../mcp/activity/mcp-activity-entity'
import { McpServerEntity } from '../mcp/mcp-entity'
import { McpOAuthClientEntity } from '../mcp/oauth/client/mcp-oauth-client.entity'
import { McpOAuthAuthorizationCodeEntity } from '../mcp/oauth/code/mcp-oauth-code.entity'
import { McpOAuthTokenEntity } from '../mcp/oauth/token/mcp-oauth-token.entity'
import { PieceMetadataEntity } from '../pieces/metadata/piece-metadata-entity'
import { PieceTranslationEntity } from '../pieces/metadata/piece-translation-entity'
import { PlatformConfigurationEntity } from '../platform/platform-configuration.entity'
import { PlatformEntity } from '../platform/platform.entity'
import { ProjectEntity } from '../project/project-entity'
import { StoreEntryEntity } from '../store-entry/store-entry-entity'
import { FieldEntity } from '../tables/field/field.entity'
import { CellEntity } from '../tables/record/cell.entity'
import { RecordEntity } from '../tables/record/record.entity'
import { TableWebhookEntity } from '../tables/table/table-webhook.entity'
import { TableEntity } from '../tables/table/table.entity'
import { TemplateEntity } from '../template/template.entity'
import { ToolSearchIndexEntity } from '../tool-search/tool-search-index.entity'
import { AppEventRoutingEntity } from '../trigger/app-event-routing/app-event-routing.entity'
import { TriggerEventEntity } from '../trigger/trigger-events/trigger-event.entity'
import { TriggerSourceEntity } from '../trigger/trigger-source/trigger-source-entity'
import { UserEntity } from '../user/user-entity'
import { UserInvitationEntity } from '../user-invitations/user-invitation.entity'
import { VariableEntity } from '../variable/variable.entity'
import { WaitpointEntity } from '../waitpoints/waitpoint-entity'
import { WaitpointSignalEntity } from '../waitpoints/waitpoint-signal-entity'
import { DatabaseType } from './database-type'
import { createPGliteDataSource } from './pglite-connection'
import { createPostgresDataSource, createPostgresMigrationDataSource } from './postgres-connection'

const databaseType = system.get(AppSystemProp.DB_TYPE)

function getEntities(): EntitySchema<unknown>[] {
    return [
        TriggerEventEntity,
        AppEventRoutingEntity,
        FileEntity,
        FlagEntity,
        FlowEntity,
        FlowVersionEntity,
        FlowRunEntity,
        ProjectEntity,
        StoreEntryEntity,
        UserEntity,
        AppConnectionEntity,
        VariableEntity,
        FolderEntity,
        PieceMetadataEntity,
        PieceTranslationEntity,
        PlatformEntity,
        PlatformConfigurationEntity,
        UserInvitationEntity,
        AIProviderEntity,
        AiUsage5mEntity,
        AiUsageDailyEntity,
        AiUsageCopyCursorEntity,
        AiUsageRunEntity,
        AiToolConfigEntity,
        PlatformModelTierEntity,
        TableEntity,
        FieldEntity,
        RecordEntity,
        CellEntity,
        TableWebhookEntity,
        UserIdentityEntity,
        McpActivityEntity,
        McpServerEntity,
        McpOAuthClientEntity,
        McpOAuthAuthorizationCodeEntity,
        McpOAuthTokenEntity,
        KnowledgeBaseFileEntity,
        KnowledgeBaseChunkEntity,
        ToolSearchIndexEntity,
        TriggerSourceEntity,
        WaitpointEntity,
        WaitpointSignalEntity,
        // Enterprise
        OtpEntity,
        TemplateEntity,
        PlatformAnalyticsReportEntity,
        // CLOUD
        EventDestinationEntity,
        ScimTokenEntity,
        UserGroupEntity,
        UserGroupMemberEntity,
        UserMfaEntity,
    ]
}

export const commonProperties = {
    subscribers: [],
    entities: getEntities(),
}

const DB_GLOBAL_KEY = '__AP_DB_CONNECTION__'

function getPersistedConnection(): DataSource | null {
    return ((globalThis as Record<string, unknown>)[DB_GLOBAL_KEY] as DataSource) ?? null
}

function setPersistedConnection(ds: DataSource | null): void {
    (globalThis as Record<string, unknown>)[DB_GLOBAL_KEY] = ds
}

const createDataSource = (): DataSource => {
    switch (databaseType) {
        case DatabaseType.PGLITE:
            return createPGliteDataSource()
        case DatabaseType.POSTGRES:
        default:
            return createPostgresDataSource()
    }
}

export const databaseConnection = (): DataSource => {
    const existing = getPersistedConnection()
    if (!isNil(existing)) {
        return existing
    }
    const ds = createDataSource()
    setPersistedConnection(ds)
    return ds
}

export const migrationDatabaseConnection = async (): Promise<DataSource> => {
    const persisted = getPersistedMigrationConnection()
    if (!isNil(persisted)) {
        return persisted
    }
    if (databaseType !== DatabaseType.POSTGRES) {
        return databaseConnection()
    }
    const dedicated = createPostgresMigrationDataSource()
    if (isNil(dedicated)) {
        return databaseConnection()
    }
    await dedicated.initialize()
    setPersistedMigrationConnection(dedicated)
    return dedicated
}

export function resetDatabaseConnection(): void {
    setPersistedConnection(null)
    setPersistedMigrationConnection(null)
}

const MIGRATION_DB_GLOBAL_KEY = '__AP_DB_MIGRATION_CONNECTION__'
function getPersistedMigrationConnection(): DataSource | null {
    return ((globalThis as Record<string, unknown>)[MIGRATION_DB_GLOBAL_KEY] as DataSource) ?? null
}
function setPersistedMigrationConnection(ds: DataSource | null): void {
    (globalThis as Record<string, unknown>)[MIGRATION_DB_GLOBAL_KEY] = ds
}
