import { QueryRunner } from 'typeorm'
import { system } from '../../../helper/system/system'
import { AppSystemProp } from '../../../helper/system/system-props'
import { DatabaseType } from '../../database-type'
import { Migration } from '../../migration'

export class InitialSchema1879000000000 implements Migration {
    name = 'InitialSchema1879000000000'
    breaking = true
    release = '0.93.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const statement of await statementsForDatabase(queryRunner)) {
            await queryRunner.query(statement)
        }
    }

    public async down(): Promise<void> {
        throw new Error('InitialSchema1879000000000 creates the whole schema and cannot be reverted')
    }
}

async function statementsForDatabase(queryRunner: QueryRunner): Promise<string[]> {
    const isPGlite = system.get(AppSystemProp.DB_TYPE) === DatabaseType.PGLITE
    const vectorInstalled = await isVectorExtensionInstalled(queryRunner)
    return SCHEMA_STATEMENTS
        .filter((statement) => vectorInstalled || !VECTOR_DEPENDENT_STATEMENT.test(statement))
        .filter((statement) => !isPGlite || !PGLITE_UNSUPPORTED_STATEMENT.test(statement))
        .map((statement) => isPGlite ? statement.replaceAll(' COLLATE public.en_natural', '') : statement)
}

async function isVectorExtensionInstalled(queryRunner: QueryRunner): Promise<boolean> {
    const result = await queryRunner.query('SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = $1) AS installed', ['vector'])
    return result[0]?.installed === true
}

const VECTOR_DEPENDENT_STATEMENT = /knowledge_base_chunk|tool_search_index/
const PGLITE_UNSUPPORTED_STATEMENT = /CREATE COLLATION public\.en_natural|USING hnsw/

const SCHEMA_STATEMENTS: string[] = [
    `
        CREATE COLLATION public.en_natural (provider = icu, locale = 'en-US-u-kn');
    `,
    `
        CREATE TABLE public."DELETED_flow_instance" (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "flowId" character varying(21) NOT NULL,
            "flowVersionId" character varying(21) NOT NULL,
            status character varying NOT NULL,
            schedule jsonb
        );
    `,
    `
        CREATE TABLE public.agent (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "ownerId" character varying(21) NOT NULL,
            "externalId" character varying NOT NULL,
            "displayName" character varying NOT NULL,
            description character varying,
            icon character varying NOT NULL,
            color character varying NOT NULL,
            visibility character varying NOT NULL,
            "sharedWithUserIds" character varying[] DEFAULT '{}'::character varying[] NOT NULL,
            draft jsonb NOT NULL,
            published jsonb,
            "folderId" character varying(21)
        );
    `,
    `
        CREATE TABLE public.agent_conversation (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21),
            "userId" character varying(21) NOT NULL,
            title character varying,
            "modelName" character varying,
            "uiMessages" jsonb,
            status character varying DEFAULT 'IDLE'::character varying NOT NULL,
            messages jsonb DEFAULT '[]'::jsonb NOT NULL,
            summary text,
            "summarizedUpToIndex" integer,
            "platformId" character varying(21) NOT NULL,
            "activeRunId" character varying,
            source character varying DEFAULT 'CHAT'::character varying NOT NULL,
            "agentId" character varying(21),
            "flowRunId" character varying(21),
            "aiCredits" integer,
            "modelTierId" character varying(21),
            "providerConfigId" character varying(21),
            "waitpointId" character varying(21)
        );
    `,
    `
        CREATE TABLE public.agent_task (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "projectId" character varying(21),
            "conversationId" character varying(21) NOT NULL,
            title character varying NOT NULL,
            status character varying NOT NULL,
            messages jsonb DEFAULT '[]'::jsonb NOT NULL,
            summary character varying,
            artifacts jsonb DEFAULT '[]'::jsonb NOT NULL,
            "claimId" character varying(21)
        );
    `,
    `
        CREATE TABLE public.ai_provider (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            config json NOT NULL,
            provider character varying NOT NULL,
            "displayName" character varying NOT NULL,
            auth json NOT NULL,
            "enabledForChat" boolean DEFAULT false NOT NULL,
            "modelScope" character varying DEFAULT 'all'::character varying NOT NULL,
            "modelIds" character varying[] DEFAULT '{}'::character varying[] NOT NULL,
            "projectScope" character varying DEFAULT 'all'::character varying NOT NULL,
            "projectIds" character varying[] DEFAULT '{}'::character varying[] NOT NULL,
            status character varying DEFAULT 'active'::character varying NOT NULL,
            "statusReason" character varying,
            "statusUpdated" timestamp with time zone,
            "statusVersion" integer DEFAULT 0 NOT NULL
        );
    `,
    `
        CREATE TABLE public.ai_tool_config (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            capability character varying NOT NULL,
            provider character varying NOT NULL,
            auth json NOT NULL,
            config json,
            enabled boolean DEFAULT false NOT NULL
        );
    `,
    `
        CREATE TABLE public.ai_usage_5m (
            bucket timestamp with time zone NOT NULL,
            "seriesId" character varying(32) NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "projectId" character varying(21),
            "flowId" character varying(21),
            "agentId" character varying(21),
            "userId" character varying(21),
            provider character varying NOT NULL,
            "providerConfigId" character varying(21),
            "modelId" character varying NOT NULL,
            origin character varying NOT NULL,
            environment character varying NOT NULL,
            calls integer DEFAULT 0 NOT NULL,
            "unpricedCalls" integer DEFAULT 0 NOT NULL,
            runs integer DEFAULT 0 NOT NULL,
            "inputTokens" bigint DEFAULT 0 NOT NULL,
            "outputTokens" bigint DEFAULT 0 NOT NULL,
            "cacheReadTokens" bigint DEFAULT 0 NOT NULL,
            "cacheWriteTokens" bigint DEFAULT 0 NOT NULL,
            "reasoningTokens" bigint DEFAULT 0 NOT NULL,
            "reportedCostUsd" double precision DEFAULT 0 NOT NULL,
            "estimatedCostUsd" double precision DEFAULT 0 NOT NULL,
            "spendUsd" double precision DEFAULT 0 NOT NULL,
            "managedCredits" double precision DEFAULT 0 NOT NULL
        )
        WITH (fillfactor='80', autovacuum_vacuum_scale_factor='0.02');
    `,
    `
        CREATE TABLE public.ai_usage_copy_cursor (
            "platformId" character varying(21) NOT NULL,
            "copiedUntil" timestamp with time zone NOT NULL,
            "startedAt" timestamp with time zone NOT NULL
        );
    `,
    `
        CREATE TABLE public.ai_usage_daily (
            day date NOT NULL,
            "seriesId" character varying(32) NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "projectId" character varying(21),
            "flowId" character varying(21),
            "agentId" character varying(21),
            "userId" character varying(21),
            provider character varying NOT NULL,
            "providerConfigId" character varying(21),
            "modelId" character varying NOT NULL,
            origin character varying NOT NULL,
            environment character varying NOT NULL,
            calls integer DEFAULT 0 NOT NULL,
            "unpricedCalls" integer DEFAULT 0 NOT NULL,
            runs integer DEFAULT 0 NOT NULL,
            "inputTokens" bigint DEFAULT 0 NOT NULL,
            "outputTokens" bigint DEFAULT 0 NOT NULL,
            "cacheReadTokens" bigint DEFAULT 0 NOT NULL,
            "cacheWriteTokens" bigint DEFAULT 0 NOT NULL,
            "reasoningTokens" bigint DEFAULT 0 NOT NULL,
            "reportedCostUsd" double precision DEFAULT 0 NOT NULL,
            "estimatedCostUsd" double precision DEFAULT 0 NOT NULL,
            "spendUsd" double precision DEFAULT 0 NOT NULL,
            "managedCredits" double precision DEFAULT 0 NOT NULL
        )
        WITH (fillfactor='80', autovacuum_vacuum_scale_factor='0.02');
    `,
    `
        CREATE TABLE public.ai_usage_run (
            "runId" character varying(21) NOT NULL,
            "seenAt" timestamp with time zone DEFAULT now() NOT NULL
        );
    `,
    `
        CREATE TABLE public.alert (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            channel character varying NOT NULL,
            receiver character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.api_key (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "displayName" character varying NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "hashedValue" character varying NOT NULL,
            "truncatedValue" character varying NOT NULL,
            "lastUsedAt" character varying
        );
    `,
    `
        CREATE TABLE public.app_connection (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "externalId" character varying NOT NULL,
            "pieceName" character varying NOT NULL,
            value jsonb NOT NULL,
            type character varying NOT NULL,
            status character varying DEFAULT 'ACTIVE'::character varying NOT NULL,
            "ownerId" character varying,
            "projectIds" character varying[] NOT NULL,
            "displayName" character varying NOT NULL,
            "platformId" character varying NOT NULL,
            scope character varying NOT NULL,
            metadata jsonb,
            "pieceVersion" character varying NOT NULL,
            "preSelectForNewProjects" boolean DEFAULT false NOT NULL
        );
    `,
    `
        CREATE TABLE public.app_credential (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "appName" character varying NOT NULL,
            "projectId" character varying(21) NOT NULL,
            settings jsonb NOT NULL
        );
    `,
    `
        CREATE TABLE public.app_event_routing (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "appName" character varying NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "flowId" character varying(21) NOT NULL,
            "identifierValue" character varying NOT NULL,
            event character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.appsumo (
            uuid character varying NOT NULL,
            plan_id character varying NOT NULL,
            activation_email character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.audit_event (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying NOT NULL,
            "projectId" character varying,
            action character varying NOT NULL,
            "userEmail" character varying,
            "projectDisplayName" character varying,
            data jsonb NOT NULL,
            ip character varying,
            "userId" character varying
        );
    `,
    `
        CREATE TABLE public.cell (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "recordId" character varying(21) NOT NULL,
            "fieldId" character varying(21) NOT NULL,
            value character varying NOT NULL,
            "projectId" character varying(21) NOT NULL
        );
    `,
    `
        CREATE VIEW public.chat_conversation AS
         SELECT id,
            created,
            updated,
            "projectId",
            "userId",
            title,
            "modelName",
            "uiMessages",
            status,
            messages,
            summary,
            "summarizedUpToIndex",
            "platformId",
            "activeRunId",
            source
           FROM public.agent_conversation;
    `,
    `
        CREATE TABLE public.chat_personalization (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "userId" character varying(21),
            domain character varying,
            "companyText" character varying,
            role character varying,
            status character varying DEFAULT 'PENDING'::character varying NOT NULL,
            "researchToken" character varying(21),
            profile jsonb,
            "useCases" jsonb
        );
    `,
    `
        CREATE TABLE public.collection (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "displayName" character varying
        );
    `,
    `
        CREATE TABLE public.collection_version (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "displayName" character varying NOT NULL,
            "collectionId" character varying(21) NOT NULL,
            configs jsonb NOT NULL,
            state character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.concurrency_pool (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            key character varying NOT NULL,
            "maxConcurrentJobs" integer NOT NULL
        );
    `,
    `
        CREATE TABLE public.connection_key (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            settings jsonb NOT NULL
        );
    `,
    `
        CREATE TABLE public.custom_domain (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            domain character varying NOT NULL,
            "platformId" character varying(21) NOT NULL,
            status character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.embed_subdomain (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            hostname character varying NOT NULL,
            status character varying NOT NULL,
            "cloudflareId" character varying NOT NULL,
            "verificationRecords" jsonb DEFAULT '[]'::jsonb NOT NULL
        );
    `,
    `
        CREATE TABLE public.event_destination (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "projectId" character varying(21),
            scope character varying NOT NULL,
            events character varying[] NOT NULL,
            url character varying NOT NULL,
            enabled boolean DEFAULT true NOT NULL,
            format character varying DEFAULT 'RAW'::character varying NOT NULL,
            headers jsonb
        );
    `,
    `
        CREATE TABLE public.field (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            name character varying NOT NULL,
            type character varying NOT NULL,
            "tableId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL,
            data jsonb,
            "externalId" character varying NOT NULL,
            "position" integer DEFAULT 0 NOT NULL
        );
    `,
    `
        CREATE TABLE public.file (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21),
            data bytea,
            type character varying DEFAULT 'UNKNOWN'::character varying NOT NULL,
            compression character varying DEFAULT 'NONE'::character varying NOT NULL,
            "platformId" character varying(21),
            location character varying NOT NULL,
            "fileName" character varying,
            size integer,
            metadata jsonb,
            "s3Key" character varying
        );
    `,
    `
        CREATE TABLE public.flag (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            value jsonb NOT NULL
        );
    `,
    `
        CREATE TABLE public.flow (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "folderId" character varying(21),
            status character varying DEFAULT 'DISABLED'::character varying NOT NULL,
            "publishedVersionId" character varying(21),
            "externalId" character varying NOT NULL,
            metadata jsonb,
            "operationStatus" character varying DEFAULT 'NONE'::character varying NOT NULL,
            "timeSavedPerRun" integer,
            "ownerId" character varying,
            "templateId" character varying,
            "createdBy" jsonb,
            "workerGroupId" character varying
        );
    `,
    `
        CREATE TABLE public.flow_approval_request (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "flowVersionId" character varying(21) NOT NULL,
            "flowId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "submitterId" character varying(21),
            "submittedAt" timestamp with time zone NOT NULL,
            "approverId" character varying(21),
            "decidedAt" timestamp with time zone,
            state character varying NOT NULL,
            "requestedStatus" character varying NOT NULL,
            "rejectionReason" text
        );
    `,
    `
        CREATE TABLE public.flow_run (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "flowId" character varying(21) NOT NULL,
            "flowVersionId" character varying(21) NOT NULL,
            environment character varying,
            "logsFileId" character varying(21),
            status character varying NOT NULL,
            "startTime" timestamp with time zone,
            "finishTime" timestamp with time zone,
            "pauseMetadata" jsonb,
            "stepsCount" integer DEFAULT 0 NOT NULL,
            tags character varying[],
            "parentRunId" character varying(21),
            "failParentOnFailure" boolean DEFAULT true NOT NULL,
            "stepNameToTest" character varying,
            "failedStep" jsonb,
            "archivedAt" character varying,
            "triggeredBy" character varying,
            timeline jsonb,
            "parentWaitpointId" character varying(21),
            "dispatchIndex" integer
        );
    `,
    `
        CREATE TABLE public.flow_template (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            name character varying NOT NULL,
            description character varying NOT NULL,
            type character varying NOT NULL,
            "platformId" character varying NOT NULL,
            "projectId" character varying,
            template jsonb NOT NULL,
            tags character varying[] NOT NULL,
            pieces character varying[] NOT NULL,
            "blogUrl" character varying,
            metadata jsonb
        );
    `,
    `
        CREATE TABLE public.flow_version (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "flowId" character varying(21) NOT NULL,
            "displayName" character varying NOT NULL,
            trigger jsonb,
            valid boolean NOT NULL,
            state character varying NOT NULL,
            "updatedBy" character varying,
            "schemaVersion" character varying,
            "connectionIds" character varying[] NOT NULL,
            "agentIds" character varying[] NOT NULL,
            "backupFiles" jsonb,
            notes jsonb NOT NULL
        );
    `,
    `
        CREATE TABLE public.folder (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "displayName" character varying NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "displayOrder" integer DEFAULT 0 NOT NULL,
            "externalId" character varying
        );
    `,
    `
        CREATE TABLE public.git_repo (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "remoteUrl" character varying NOT NULL,
            branch character varying NOT NULL,
            "branchType" character varying DEFAULT 'DEVELOPMENT'::character varying NOT NULL,
            "sshPrivateKey" character varying,
            slug character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.instance (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "collectionId" character varying(21) NOT NULL,
            "flowIdToVersionId" jsonb NOT NULL,
            status character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.knowledge_base_chunk (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "knowledgeBaseFileId" character varying(21) NOT NULL,
            content text NOT NULL,
            "chunkIndex" integer NOT NULL,
            embedding public.vector(768),
            metadata jsonb
        );
    `,
    `
        CREATE TABLE public.knowledge_base_file (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "fileId" character varying(21) NOT NULL,
            "displayName" character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.mcp (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            token character varying NOT NULL,
            name character varying NOT NULL,
            "externalId" character varying(21) NOT NULL
        );
    `,
    `
        CREATE TABLE public.mcp_activity (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "projectId" character varying(21),
            "userId" character varying(21) NOT NULL,
            "clientKey" character varying(32),
            "toolName" character varying(128) NOT NULL,
            status character varying(32) NOT NULL,
            "pieceName" character varying(256),
            "actionName" character varying(256),
            "connectionExternalId" character varying(256),
            "errorMessage" character varying(2000),
            "durationMs" integer NOT NULL,
            "payloadFileId" character varying(21),
            "payloadTruncated" boolean DEFAULT false NOT NULL
        );
    `,
    `
        CREATE TABLE public.mcp_oauth_authorization_code (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            code character varying(128) NOT NULL,
            "clientId" character varying(64) NOT NULL,
            "userId" character varying(21) NOT NULL,
            "projectId" character varying(21),
            "platformId" character varying(21) NOT NULL,
            "redirectUri" character varying(2048) NOT NULL,
            "codeChallenge" character varying(256) NOT NULL,
            "codeChallengeMethod" character varying(8) DEFAULT 'S256'::character varying NOT NULL,
            scopes character varying[],
            state character varying(2048),
            "expiresAt" timestamp with time zone NOT NULL,
            used boolean DEFAULT false NOT NULL,
            nonce character varying(512)
        );
    `,
    `
        CREATE TABLE public.mcp_oauth_client (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "clientId" character varying(64) NOT NULL,
            "clientSecret" character varying(128),
            "clientSecretExpiresAt" bigint DEFAULT 0 NOT NULL,
            "clientIdIssuedAt" bigint NOT NULL,
            "redirectUris" character varying[] NOT NULL,
            "clientName" character varying(255),
            "grantTypes" character varying[] NOT NULL,
            "tokenEndpointAuthMethod" character varying(64) DEFAULT 'none'::character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.mcp_oauth_token (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "refreshToken" character varying(128) NOT NULL,
            "clientId" character varying(64) NOT NULL,
            "userId" character varying(21) NOT NULL,
            "projectId" character varying(21),
            "platformId" character varying(21) NOT NULL,
            scopes character varying[],
            "expiresAt" timestamp with time zone NOT NULL,
            revoked boolean DEFAULT false NOT NULL,
            "lastUsedAt" timestamp with time zone,
            "clientKey" character varying(32)
        );
    `,
    `
        CREATE TABLE public.mcp_server (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21),
            token character varying NOT NULL,
            "platformId" character varying(21),
            type character varying NOT NULL,
            "disabledTools" jsonb
        );
    `,
    `
        CREATE TABLE public.mcp_tool (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "mcpId" character varying(21) NOT NULL,
            type character varying NOT NULL,
            "pieceMetadata" jsonb,
            "flowId" character varying,
            "externalId" character varying(21) NOT NULL
        );
    `,
    `
        CREATE TABLE public.oauth_app (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "pieceName" character varying NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "clientId" character varying NOT NULL,
            "clientSecret" jsonb NOT NULL
        );
    `,
    `
        CREATE TABLE public.otp (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            type character varying NOT NULL,
            "identityId" character varying(21) NOT NULL,
            value character varying NOT NULL,
            state character varying NOT NULL,
            attempts integer DEFAULT 0 NOT NULL,
            version integer DEFAULT 0 NOT NULL
        );
    `,
    `
        CREATE TABLE public.piece_metadata (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            name character varying NOT NULL,
            "displayName" character varying NOT NULL,
            "logoUrl" character varying NOT NULL,
            description character varying,
            version character varying NOT NULL COLLATE public.en_natural,
            "minimumSupportedRelease" character varying NOT NULL COLLATE public.en_natural,
            "maximumSupportedRelease" character varying NOT NULL COLLATE public.en_natural,
            actions json NOT NULL,
            triggers json NOT NULL,
            auth json,
            "pieceType" character varying NOT NULL,
            "packageType" character varying NOT NULL,
            "archiveId" character varying(21),
            "platformId" character varying,
            categories character varying[],
            authors character varying[] NOT NULL,
            "projectUsage" integer DEFAULT 0 NOT NULL,
            i18n json,
            deprecated boolean
        );
    `,
    `
        CREATE TABLE public.piece_set (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            name character varying NOT NULL,
            key character varying,
            "isDefault" boolean DEFAULT false NOT NULL,
            "generatedForProjectId" character varying(21),
            config jsonb DEFAULT '{"pieces": {"mode": "include_all", "exceptions": []}, "requiredActions": {"mode": "any", "actions": {}}, "selectedActions": {}, "selectedTriggers": {}}'::jsonb NOT NULL
        );
    `,
    `
        CREATE TABLE public.piece_translation (
            "pieceMetadataId" character varying(21) NOT NULL,
            locale character varying NOT NULL,
            translations jsonb NOT NULL
        );
    `,
    `
        CREATE TABLE public.platform (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "ownerId" character varying(21) NOT NULL,
            name character varying NOT NULL,
            "primaryColor" character varying NOT NULL,
            "logoIconUrl" character varying NOT NULL,
            "fullLogoUrl" character varying NOT NULL,
            "favIconUrl" character varying NOT NULL,
            "cloudAuthEnabled" boolean DEFAULT true NOT NULL,
            "allowedAuthDomains" character varying[] NOT NULL,
            "enforceAllowedAuthDomains" boolean NOT NULL,
            "emailAuthEnabled" boolean NOT NULL,
            "federatedAuthProviders" jsonb NOT NULL,
            "pinnedPieces" character varying[] NOT NULL,
            "themeColors" jsonb,
            "allowedEmbedOrigins" character varying[] DEFAULT '{}'::character varying[] NOT NULL,
            "googleAuthEnabled" boolean DEFAULT true NOT NULL,
            "ssoDomain" character varying,
            "ssoDomainVerification" jsonb,
            "pieceSelectorConfig" jsonb,
            "autoCreatePersonalProjects" boolean DEFAULT true NOT NULL,
            "auditLogRetentionDays" integer
        );
    `,
    `
        CREATE TABLE public.platform_analytics_report (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying NOT NULL,
            users jsonb NOT NULL,
            "cachedAt" timestamp without time zone NOT NULL,
            runs jsonb NOT NULL,
            flows jsonb NOT NULL,
            outdated boolean NOT NULL
        );
    `,
    `
        CREATE TABLE public.platform_configuration (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "isProductTelemetryEnabled" boolean DEFAULT true NOT NULL,
            "isInfraSetupTelemetryEnabled" boolean DEFAULT true NOT NULL,
            "maxBarrierSignals" integer DEFAULT 10000 NOT NULL,
            "aiSpecificModelsVisible" boolean DEFAULT true NOT NULL,
            "defaultChatModel" jsonb
        );
    `,
    `
        CREATE TABLE public.platform_model_tier (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            name character varying NOT NULL,
            emoji character varying NOT NULL,
            description character varying,
            "position" integer DEFAULT 0 NOT NULL,
            entries jsonb NOT NULL,
            "isDefault" boolean DEFAULT false NOT NULL,
            "thinkingBudget" integer,
            deleted timestamp with time zone,
            "replacedBy" character varying(21),
            "isFast" boolean DEFAULT false NOT NULL
        );
    `,
    `
        CREATE TABLE public.platform_plan (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            plan character varying,
            "includedAiCredits" integer DEFAULT 0 NOT NULL,
            "stripeSubscriptionStartDate" integer,
            "stripeSubscriptionEndDate" integer,
            "stripeSubscriptionCancelDate" integer,
            "environmentsEnabled" boolean NOT NULL,
            "analyticsEnabled" boolean NOT NULL,
            "showPoweredBy" boolean NOT NULL,
            "auditLogEnabled" boolean NOT NULL,
            "embeddingEnabled" boolean NOT NULL,
            "managePiecesEnabled" boolean NOT NULL,
            "manageTemplatesEnabled" boolean NOT NULL,
            "customAppearanceEnabled" boolean NOT NULL,
            "teamProjectsLimit" character varying DEFAULT 'NONE'::character varying NOT NULL,
            "projectRolesEnabled" boolean NOT NULL,
            "customDomainsEnabled" boolean NOT NULL,
            "globalConnectionsEnabled" boolean NOT NULL,
            "customRolesEnabled" boolean NOT NULL,
            "apiKeysEnabled" boolean NOT NULL,
            "ssoEnabled" boolean NOT NULL,
            "licenseKey" character varying,
            "stripeCustomerId" character varying,
            "stripeSubscriptionId" character varying,
            "stripeSubscriptionStatus" character varying,
            "tablesEnabled" boolean NOT NULL,
            "projectsLimit" integer,
            "activeFlowsLimit" integer,
            "dedicatedWorkers" jsonb,
            "aiCreditsAutoTopUpCreditsToAdd" integer,
            "aiCreditsAutoTopUpThreshold" integer,
            "aiCreditsAutoTopUpState" character varying DEFAULT 'disabled'::character varying NOT NULL,
            "lastFreeAiCreditsRenewalDate" timestamp with time zone,
            "maxAutoTopUpCreditsMonthly" integer,
            "eventStreamingEnabled" boolean NOT NULL,
            "scimEnabled" boolean NOT NULL,
            "secretManagersEnabled" boolean NOT NULL,
            "agentsEnabled" boolean DEFAULT true NOT NULL,
            canary boolean DEFAULT false NOT NULL,
            "workerGroupId" character varying,
            "aiProvidersEnabled" boolean DEFAULT false NOT NULL,
            "chatEnabled" boolean NOT NULL,
            "workerGroupsEnabled" boolean DEFAULT false NOT NULL,
            "autumnCustomerId" character varying,
            "autumnApiKey" character varying,
            "usersLimit" integer,
            "scheduledUsersLimit" integer,
            "includedCredits" integer DEFAULT 0 NOT NULL,
            "billedTeamProjectsLimit" integer
        );
    `,
    `
        CREATE TABLE public.project (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "ownerId" character varying(21) NOT NULL,
            "displayName" character varying NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "externalId" character varying,
            deleted timestamp with time zone,
            "releasesEnabled" boolean DEFAULT false NOT NULL,
            metadata jsonb,
            "maxConcurrentJobs" integer,
            icon jsonb NOT NULL,
            type character varying NOT NULL,
            "poolId" character varying(21),
            "workerGroupId" character varying,
            "pieceSetId" character varying(21),
            "notifyFlowOwnerOnFailure" boolean DEFAULT false NOT NULL,
            "executionDataRetentionDays" integer,
            sensitive boolean DEFAULT false NOT NULL,
            "isDefault" boolean DEFAULT false NOT NULL
        );
    `,
    `
        CREATE TABLE public.project_member (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "userId" character varying(21) NOT NULL,
            "projectRoleId" character varying(21) NOT NULL
        );
    `,
    `
        CREATE TABLE public.project_plan (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            name character varying NOT NULL,
            pieces character varying[] NOT NULL,
            locked boolean DEFAULT false NOT NULL,
            "piecesFilterType" character varying NOT NULL,
            "activeFlowsLimit" integer
        );
    `,
    `
        CREATE TABLE public.project_release (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying NOT NULL,
            name character varying NOT NULL,
            description character varying,
            "importedBy" character varying(21),
            "fileId" character varying NOT NULL,
            type character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.project_role (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            name character varying NOT NULL,
            permissions character varying[] NOT NULL,
            "platformId" character varying,
            type character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.project_usage (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "consumedTasks" integer NOT NULL,
            "nextResetDatetime" timestamp with time zone NOT NULL
        );
    `,
    `
        CREATE TABLE public.record (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "tableId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL
        );
    `,
    `
        CREATE TABLE public.secret_manager_connection (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "providerId" character varying NOT NULL,
            auth jsonb,
            scope character varying DEFAULT 'PLATFORM'::character varying NOT NULL,
            "projectIds" jsonb,
            name character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.signing_key (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "displayName" character varying NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "publicKey" character varying NOT NULL,
            algorithm character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.step_file (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "flowId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL,
            name character varying NOT NULL,
            size integer NOT NULL,
            "stepName" character varying NOT NULL,
            data bytea NOT NULL
        );
    `,
    `
        CREATE TABLE public."store-entry" (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            key character varying(128) NOT NULL,
            "projectId" character varying(21) NOT NULL,
            value jsonb
        );
    `,
    `
        CREATE TABLE public."table" (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            name character varying NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "externalId" character varying NOT NULL,
            trigger character varying,
            status character varying,
            "folderId" character varying(21)
        );
    `,
    `
        CREATE TABLE public.table_webhook (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "tableId" character varying(21) NOT NULL,
            events character varying[] NOT NULL,
            "flowId" character varying(21) NOT NULL
        );
    `,
    `
        CREATE TABLE public.template (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying,
            type character varying NOT NULL,
            name character varying NOT NULL,
            summary character varying NOT NULL,
            description character varying NOT NULL,
            flows jsonb,
            tags jsonb NOT NULL,
            "blogUrl" character varying,
            metadata jsonb,
            author character varying NOT NULL,
            categories character varying[] NOT NULL,
            pieces character varying[] NOT NULL,
            status character varying NOT NULL,
            tables jsonb
        );
    `,
    `
        CREATE TABLE public.todo (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            title character varying NOT NULL,
            description character varying,
            status jsonb NOT NULL,
            "statusOptions" jsonb NOT NULL,
            "assigneeId" character varying(21),
            "platformId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "flowId" character varying(21),
            "runId" character varying(21),
            "resolveUrl" character varying,
            locked boolean DEFAULT false NOT NULL,
            "createdByUserId" character varying(21),
            environment character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.todo_activity (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "todoId" character varying(21) NOT NULL,
            "userId" character varying(21),
            content jsonb NOT NULL
        );
    `,
    `
        CREATE TABLE public.todo_comment (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "todoId" character varying(21) NOT NULL,
            "userId" character varying(21) NOT NULL,
            content character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.tool_search_index (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "objectKind" character varying NOT NULL,
            "pieceName" character varying NOT NULL,
            "pieceVersion" character varying NOT NULL,
            "objectName" character varying NOT NULL,
            "displayName" character varying NOT NULL,
            "retrievalDoc" text NOT NULL,
            audience character varying,
            "requiresConnection" boolean DEFAULT false NOT NULL,
            categories character varying[],
            "modelVersion" character varying NOT NULL,
            "embeddingInputHash" character varying NOT NULL,
            embedding public.vector,
            "platformId" character varying(21)
        );
    `,
    `
        CREATE TABLE public.trigger_event (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "flowId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "sourceName" character varying NOT NULL,
            "fileId" character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.trigger_run (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "payloadFileId" character varying,
            "pieceName" character varying NOT NULL,
            "pieceVersion" character varying NOT NULL,
            error character varying,
            status character varying NOT NULL,
            "triggerSourceId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "jobId" character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public.trigger_source (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            deleted timestamp with time zone,
            "flowId" character varying NOT NULL,
            "flowVersionId" character varying NOT NULL,
            "projectId" character varying NOT NULL,
            type character varying NOT NULL,
            schedule jsonb,
            "pieceName" character varying NOT NULL,
            "pieceVersion" character varying NOT NULL,
            simulate boolean NOT NULL,
            "triggerName" character varying NOT NULL
        );
    `,
    `
        CREATE TABLE public."user" (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            status character varying NOT NULL,
            "externalId" character varying,
            "platformId" character varying,
            "platformRole" character varying NOT NULL,
            "identityId" character varying NOT NULL,
            "lastActiveDate" timestamp with time zone
        );
    `,
    `
        CREATE TABLE public.user_memory (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying(21) NOT NULL,
            "userId" character varying(21) NOT NULL,
            instructions character varying,
            memories jsonb DEFAULT '[]'::jsonb NOT NULL
        );
    `,
    `
        CREATE VIEW public.user_chat_memory AS
         SELECT id,
            created,
            updated,
            "platformId",
            "userId",
            instructions,
            memories
           FROM public.user_memory;
    `,
    `
        CREATE TABLE public.user_identity (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            email character varying NOT NULL,
            password character varying NOT NULL,
            "trackEvents" boolean,
            "newsLetter" boolean,
            verified boolean DEFAULT false NOT NULL,
            "firstName" character varying NOT NULL,
            "lastName" character varying NOT NULL,
            "tokenVersion" character varying,
            provider character varying NOT NULL,
            "imageUrl" character varying,
            "lastLoggedInPlatformId" character varying(21)
        );
    `,
    `
        CREATE TABLE public.user_invitation (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "platformId" character varying NOT NULL,
            type character varying NOT NULL,
            "platformRole" character varying,
            email character varying NOT NULL,
            "projectId" character varying,
            status character varying NOT NULL,
            "projectRoleId" character varying
        );
    `,
    `
        CREATE TABLE public.variable (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            name character varying NOT NULL,
            "projectId" character varying NOT NULL,
            "platformId" character varying NOT NULL,
            "ownerId" character varying,
            value jsonb NOT NULL,
            metadata jsonb
        );
    `,
    `
        CREATE TABLE public.waitpoint (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "flowRunId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL,
            type character varying NOT NULL,
            status character varying NOT NULL,
            version character varying DEFAULT 'V0'::character varying NOT NULL,
            "stepName" character varying DEFAULT ''::character varying NOT NULL,
            "resumeDateTime" timestamp with time zone,
            "responseToSend" jsonb,
            "workerHandlerId" character varying,
            "httpRequestId" character varying,
            "resumePayload" jsonb,
            sealed boolean DEFAULT false NOT NULL,
            policy jsonb,
            "deadLetteredAt" timestamp with time zone
        );
    `,
    `
        CREATE TABLE public.waitpoint_signal (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "waitpointId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL,
            status character varying NOT NULL,
            "refId" character varying,
            sequence integer,
            label character varying,
            result jsonb
        );
    `,
    `
        CREATE TABLE public.webhook_simulation (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            "flowId" character varying(21) NOT NULL,
            "projectId" character varying(21) NOT NULL
        );
    `,
    `
        CREATE TABLE public.worker_machine (
            id character varying(21) NOT NULL,
            created timestamp with time zone DEFAULT now() NOT NULL,
            updated timestamp with time zone DEFAULT now() NOT NULL,
            information jsonb NOT NULL
        );
    `,
    `
        ALTER TABLE ONLY public.step_file
            ADD CONSTRAINT "PK_04bb9022ff8c2190fea2036174e" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.secret_manager_connection
            ADD CONSTRAINT "PK_0ae8f80f081a7b8889212816aac" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.project_usage
            ADD CONSTRAINT "PK_100c1959e9dc487c4cadbf9cb56" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.ai_provider
            ADD CONSTRAINT "PK_1046c2cb42f99614e1c7873744b" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.project_release
            ADD CONSTRAINT "PK_11aa4566a8a7a623e5c3f9809fe" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.flag
            ADD CONSTRAINT "PK_17b74257294fdfd221178a132d4" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.app_event_routing
            ADD CONSTRAINT "PK_2107df2b2faf9d50435f9d5acd7" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.todo_activity
            ADD CONSTRAINT "PK_26f3e77e6ab71cf79485f4bc5d1" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public."table"
            ADD CONSTRAINT "PK_28914b55c485fc2d7a101b1b2a4" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.flow_version
            ADD CONSTRAINT "PK_2f20a52dcddf98d3fafe621a9f5" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.otp
            ADD CONSTRAINT "PK_32556d9d7b22031d7d0e1fd6723" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.oauth_app
            ADD CONSTRAINT "PK_3256b97c0a3ee2d67240805dca4" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.appsumo
            ADD CONSTRAINT "PK_3589df5be2973351814f727ae86" PRIMARY KEY (uuid);
    `,
    `
        ALTER TABLE ONLY public.file
            ADD CONSTRAINT "PK_36b46d232307066b3a2c9ea3a1d" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.field
            ADD CONSTRAINT "PK_39379bba786d7a75226b358f81e" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.project_role
            ADD CONSTRAINT "PK_3c677495ab48997b2dc02048289" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.user_invitation
            ADD CONSTRAINT "PK_41026b90b70299ac5dc0183351a" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.audit_event
            ADD CONSTRAINT "PK_481efbe8b0a403efe3f47a6528f" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.project
            ADD CONSTRAINT "PK_4d68b1358bb5b766d3e78f32f57" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.connection_key
            ADD CONSTRAINT "PK_4dcf1d9ae4ba5eb261a6c775ad2" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public."DELETED_flow_instance"
            ADD CONSTRAINT "PK_5b0308060b7de5abec61ac5d2db" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.record
            ADD CONSTRAINT "PK_5cb1f4d1aff275cf9001f4343b9" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.signing_key
            ADD CONSTRAINT "PK_5cc161da020c79bb3ac9953edae" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.folder
            ADD CONSTRAINT "PK_6278a41a706740c94c02e288df8" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.app_credential
            ADD CONSTRAINT "PK_62eb102bb75a05d2951796a3b46" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.project_member
            ADD CONSTRAINT "PK_64dba8e9dcf96ce383cfd19d6fb" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.webhook_simulation
            ADD CONSTRAINT "PK_6854a1ac9a5b24810b29aaf0f43" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.table_webhook
            ADD CONSTRAINT "PK_69093ef390cfa098e6404cc85a8" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.flow
            ADD CONSTRAINT "PK_6c2ad4a3e86394cd9bb7a80a228" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.cell
            ADD CONSTRAINT "PK_6f34717c251843e5ca32fc1b2b8" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.project_plan
            ADD CONSTRAINT "PK_759d33fce71c95de832df935841" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.custom_domain
            ADD CONSTRAINT "PK_76b2cc5a1514eeffc66184c922a" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.collection_version
            ADD CONSTRAINT "PK_76c769e96c091b478e3c338a0ac" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.trigger_event
            ADD CONSTRAINT "PK_79bbc8c2af95776e801c7eaab11" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.todo_comment
            ADD CONSTRAINT "PK_839f4b538f52d8030ecf2367e4c" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.trigger_run
            ADD CONSTRAINT "PK_851d8c64cc2afc9b528c4473213" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.flow_run
            ADD CONSTRAINT "PK_858b1dd0d1055c44261ae00d45b" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.user_identity
            ADD CONSTRAINT "PK_87b5856b206b5b77e6e2fa29508" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.platform_analytics_report
            ADD CONSTRAINT "PK_8b060dc8b2e5d9d91162ce2cc11" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.mcp
            ADD CONSTRAINT "PK_8d67eeb70e7ea0332150517d1cb" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.mcp_server
            ADD CONSTRAINT "PK_940f98ed91dd060f63e6fc5634e" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.worker_machine
            ADD CONSTRAINT "PK_9d6b1b7507214e3480582ef32e7" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.app_connection
            ADD CONSTRAINT "PK_9efa2d6633ecc57cc5adeafa039" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.trigger_source
            ADD CONSTRAINT "PK_aaccba5b6e8aa2f14f108504508" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.collection
            ADD CONSTRAINT "PK_ad3f485bbc99d875491f44d7c85" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public."store-entry"
            ADD CONSTRAINT "PK_afb44ca7c0b4606b19deb1680d6" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.ai_tool_config
            ADD CONSTRAINT "PK_ai_tool_config" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.piece_metadata
            ADD CONSTRAINT "PK_b045821e9caf2be9aba520d96da" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.api_key
            ADD CONSTRAINT "PK_b1bd840641b8acbaad89c3d8d11" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.mcp_tool
            ADD CONSTRAINT "PK_ba54d700cb4059f5f48121840bd" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.platform
            ADD CONSTRAINT "PK_c33d6abeebd214bd2850bfd6b8e" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public."user"
            ADD CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.platform_plan
            ADD CONSTRAINT "PK_d08fdd63b2b6e31d68b0134977f" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.todo
            ADD CONSTRAINT "PK_d429b7114371f6a35c5cb4776a7" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.git_repo
            ADD CONSTRAINT "PK_de881ac6eac39e4d9ba7c5ed3e6" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.event_destination
            ADD CONSTRAINT "PK_e0fe710f7b5b768b59270f7ac05" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.instance
            ADD CONSTRAINT "PK_eaf60e4a0c399c9935413e06474" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.template
            ADD CONSTRAINT "PK_fbae2ac36bd9b5e1e793b957b7f" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.flow_template
            ADD CONSTRAINT "PK_fcacbf8776a0a3337eb8eca7478" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.mcp_activity
            ADD CONSTRAINT "PK_mcp_activity_id" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.mcp_oauth_authorization_code
            ADD CONSTRAINT "PK_mcp_oauth_authorization_code" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.mcp_oauth_client
            ADD CONSTRAINT "PK_mcp_oauth_client" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.mcp_oauth_token
            ADD CONSTRAINT "PK_mcp_oauth_token" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.platform_model_tier
            ADD CONSTRAINT "PK_platform_model_tier" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.user_memory
            ADD CONSTRAINT "PK_user_memory" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.variable
            ADD CONSTRAINT "PK_variable_id" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.waitpoint
            ADD CONSTRAINT "PK_waitpoint" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.waitpoint_signal
            ADD CONSTRAINT "PK_waitpoint_signal" PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.project_plan
            ADD CONSTRAINT "REL_4f52e89612966d95843e4158bb" UNIQUE ("projectId");
    `,
    `
        ALTER TABLE ONLY public.git_repo
            ADD CONSTRAINT "REL_5b59d96420074128fc1d269b9c" UNIQUE ("projectId");
    `,
    `
        ALTER TABLE ONLY public.instance
            ADD CONSTRAINT "REL_6b75536fbdf7d8dc967fc350ff" UNIQUE ("collectionId");
    `,
    `
        ALTER TABLE ONLY public.platform
            ADD CONSTRAINT "REL_94d6fd6494f0322c6f0e099141" UNIQUE ("ownerId");
    `,
    `
        ALTER TABLE ONLY public.trigger_run
            ADD CONSTRAINT "REL_b76b435f583d4e68c892a7fafa" UNIQUE ("payloadFileId");
    `,
    `
        ALTER TABLE ONLY public."DELETED_flow_instance"
            ADD CONSTRAINT "REL_cb897f5e48cc3cba1418966326" UNIQUE ("flowId");
    `,
    `
        ALTER TABLE ONLY public."DELETED_flow_instance"
            ADD CONSTRAINT "REL_ec72f514c21734fb7a08797d75" UNIQUE ("flowVersionId");
    `,
    `
        ALTER TABLE ONLY public."store-entry"
            ADD CONSTRAINT "UQ_6f251cc141de0a8d84d7a4ac17d" UNIQUE ("projectId", key);
    `,
    `
        ALTER TABLE ONLY public.user_identity
            ADD CONSTRAINT "UQ_7ad44f9fcbfc95e0a8436bbb029" UNIQUE (email);
    `,
    `
        ALTER TABLE ONLY public.piece_metadata
            ADD CONSTRAINT "UQ_b43d7b070f0fc309932d4cf0165" UNIQUE ("archiveId");
    `,
    `
        ALTER TABLE ONLY public.flow
            ADD CONSTRAINT "UQ_f6608fe13b916017a8202f993cb" UNIQUE ("publishedVersionId");
    `,
    `
        ALTER TABLE ONLY public.alert
            ADD CONSTRAINT alert_pkey PRIMARY KEY (id);
    `,
    `
        ALTER TABLE public.project
            ADD CONSTRAINT chk_project_is_default_team CHECK ((((type)::text = 'TEAM'::text) OR ("isDefault" = false))) NOT VALID;
    `,
    `
        ALTER TABLE ONLY public.agent
            ADD CONSTRAINT pk_agent PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.agent_conversation
            ADD CONSTRAINT pk_agent_conversation PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.agent_task
            ADD CONSTRAINT pk_agent_task PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.ai_usage_5m
            ADD CONSTRAINT pk_ai_usage_5m PRIMARY KEY (bucket, "seriesId");
    `,
    `
        ALTER TABLE ONLY public.ai_usage_copy_cursor
            ADD CONSTRAINT pk_ai_usage_copy_cursor PRIMARY KEY ("platformId");
    `,
    `
        ALTER TABLE ONLY public.ai_usage_daily
            ADD CONSTRAINT pk_ai_usage_daily PRIMARY KEY (day, "seriesId");
    `,
    `
        ALTER TABLE ONLY public.ai_usage_run
            ADD CONSTRAINT pk_ai_usage_run PRIMARY KEY ("runId");
    `,
    `
        ALTER TABLE ONLY public.chat_personalization
            ADD CONSTRAINT pk_chat_personalization PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.concurrency_pool
            ADD CONSTRAINT pk_concurrency_pool PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.embed_subdomain
            ADD CONSTRAINT pk_embed_subdomain PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.flow_approval_request
            ADD CONSTRAINT pk_flow_approval_request PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.knowledge_base_chunk
            ADD CONSTRAINT pk_knowledge_base_chunk PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.knowledge_base_file
            ADD CONSTRAINT pk_knowledge_base_file PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.piece_set
            ADD CONSTRAINT pk_piece_set PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.piece_translation
            ADD CONSTRAINT pk_piece_translation PRIMARY KEY ("pieceMetadataId", locale);
    `,
    `
        ALTER TABLE ONLY public.platform_configuration
            ADD CONSTRAINT pk_platform_configuration PRIMARY KEY (id);
    `,
    `
        ALTER TABLE ONLY public.tool_search_index
            ADD CONSTRAINT pk_tool_search_index PRIMARY KEY (id);
    `,
    `
        CREATE INDEX audit_event_platform_id_action_idx ON public.audit_event USING btree ("platformId", action);
    `,
    `
        CREATE INDEX audit_event_platform_id_created_id_desc_idx ON public.audit_event USING btree ("platformId", created DESC, id DESC);
    `,
    `
        CREATE INDEX audit_event_platform_id_project_id_user_id_action_idx ON public.audit_event USING btree ("platformId", "projectId", "userId", action);
    `,
    `
        CREATE INDEX audit_event_platform_id_user_id_action_idx ON public.audit_event USING btree ("platformId", "userId", action);
    `,
    `
        CREATE UNIQUE INDEX custom_domain_domain_unique ON public.custom_domain USING btree (domain);
    `,
    `
        CREATE INDEX idx_agent_conversation_agent_runs_created_id ON public.agent_conversation USING btree ("projectId", "agentId", created, id) WHERE (((source)::text = 'FLOW_STEP'::text) AND ("agentId" IS NOT NULL));
    `,
    `
        CREATE INDEX idx_agent_conversation_agent_user_created_id ON public.agent_conversation USING btree ("agentId", "userId", created, id) WHERE ("agentId" IS NOT NULL);
    `,
    `
        CREATE INDEX idx_agent_conversation_flow_step_created ON public.agent_conversation USING btree (created, "projectId") WHERE ((source)::text = 'FLOW_STEP'::text);
    `,
    `
        CREATE INDEX idx_agent_conversation_platform_provider_config ON public.agent_conversation USING btree ("platformId", "providerConfigId") WHERE ("providerConfigId" IS NOT NULL);
    `,
    `
        CREATE INDEX idx_agent_conversation_platform_user_created_id ON public.agent_conversation USING btree ("platformId", "userId", created, id);
    `,
    `
        CREATE INDEX idx_agent_conversation_streaming_updated ON public.agent_conversation USING btree (updated) WHERE ((status)::text = 'STREAMING'::text);
    `,
    `
        CREATE INDEX idx_agent_folder_id ON public.agent USING btree ("folderId");
    `,
    `
        CREATE INDEX idx_agent_project_created_id ON public.agent USING btree ("projectId", created, id);
    `,
    `
        CREATE UNIQUE INDEX idx_agent_project_external_id ON public.agent USING btree ("projectId", "externalId");
    `,
    `
        CREATE INDEX idx_agent_task_platform_conversation_created ON public.agent_task USING btree ("platformId", "conversationId", created);
    `,
    `
        CREATE UNIQUE INDEX idx_ai_provider_platform_id_managed ON public.ai_provider USING btree ("platformId") WHERE ((provider)::text = 'activepieces'::text);
    `,
    `
        CREATE INDEX idx_ai_provider_platform_id_provider ON public.ai_provider USING btree ("platformId", provider);
    `,
    `
        CREATE INDEX idx_ai_provider_project_ids_gin ON public.ai_provider USING gin ("projectIds");
    `,
    `
        CREATE UNIQUE INDEX idx_ai_tool_config_platform_capability ON public.ai_tool_config USING btree ("platformId", capability);
    `,
    `
        CREATE INDEX idx_ai_usage_5m_platform_id_bucket ON public.ai_usage_5m USING btree ("platformId", bucket);
    `,
    `
        CREATE INDEX idx_ai_usage_daily_platform_id_day ON public.ai_usage_daily USING btree ("platformId", day);
    `,
    `
        CREATE INDEX idx_ai_usage_run_seen_at ON public.ai_usage_run USING btree ("seenAt");
    `,
    `
        CREATE INDEX idx_app_connection_owner_id ON public.app_connection USING btree ("ownerId");
    `,
    `
        CREATE INDEX idx_app_connection_platform_id_and_external_id ON public.app_connection USING btree ("platformId", "externalId");
    `,
    `
        CREATE INDEX idx_app_connection_project_ids_gin ON public.app_connection USING gin ("projectIds");
    `,
    `
        CREATE INDEX "idx_app_event_appName_identifier_event" ON public.app_event_routing USING btree ("appName", "identifierValue", event);
    `,
    `
        CREATE UNIQUE INDEX "idx_app_event_flow_id_project_id_appName_identifier_value_event" ON public.app_event_routing USING btree ("appName", "projectId", "flowId", "identifierValue", event);
    `,
    `
        CREATE INDEX idx_app_event_routing_flow_id ON public.app_event_routing USING btree ("flowId");
    `,
    `
        CREATE INDEX idx_cell_field_id ON public.cell USING btree ("fieldId");
    `,
    `
        CREATE UNIQUE INDEX idx_cell_project_id_field_id_record_id_unique ON public.cell USING btree ("projectId", "fieldId", "recordId");
    `,
    `
        CREATE INDEX idx_cell_record_id ON public.cell USING btree ("recordId");
    `,
    `
        CREATE INDEX idx_chat_personalization_platform ON public.chat_personalization USING btree ("platformId");
    `,
    `
        CREATE UNIQUE INDEX idx_chat_personalization_platform_company ON public.chat_personalization USING btree ("platformId") WHERE ("userId" IS NULL);
    `,
    `
        CREATE UNIQUE INDEX idx_chat_personalization_platform_user ON public.chat_personalization USING btree ("platformId", "userId") WHERE ("userId" IS NOT NULL);
    `,
    `
        CREATE INDEX idx_collection_project_id ON public.collection USING btree ("projectId");
    `,
    `
        CREATE INDEX idx_collection_version_collection_id ON public.collection_version USING btree ("collectionId");
    `,
    `
        CREATE UNIQUE INDEX idx_concurrency_pool_platform_key ON public.concurrency_pool USING btree ("platformId", key);
    `,
    `
        CREATE INDEX idx_connection_key_project_id ON public.connection_key USING btree ("projectId");
    `,
    `
        CREATE INDEX idx_created_piece_name_platform_id ON public.trigger_run USING btree (created, "platformId", "pieceName");
    `,
    `
        CREATE INDEX idx_custom_domain_platform_id ON public.custom_domain USING btree ("platformId");
    `,
    `
        CREATE UNIQUE INDEX idx_embed_subdomain_hostname ON public.embed_subdomain USING btree (hostname);
    `,
    `
        CREATE UNIQUE INDEX idx_embed_subdomain_platform_id ON public.embed_subdomain USING btree ("platformId");
    `,
    `
        CREATE INDEX idx_event_destination_platform_scope ON public.event_destination USING btree ("platformId") WHERE ((scope)::text = 'PLATFORM'::text);
    `,
    `
        CREATE INDEX idx_event_destination_project_scope ON public.event_destination USING btree ("projectId") WHERE ((scope)::text = 'PROJECT'::text);
    `,
    `
        CREATE INDEX idx_field_project_id_table_id_name ON public.field USING btree ("projectId", "tableId", name);
    `,
    `
        CREATE INDEX idx_file_platform_id_null_project ON public.file USING btree ("platformId") WHERE ("projectId" IS NULL);
    `,
    `
        CREATE INDEX idx_file_project_id_type_created ON public.file USING btree ("projectId", type, created);
    `,
    `
        CREATE INDEX idx_file_sample_data_flow_id ON public.file USING btree (type, ((metadata ->> 'flowId'::text))) WHERE ((type)::text = ANY ((ARRAY['SAMPLE_DATA'::character varying, 'SAMPLE_DATA_INPUT'::character varying])::text[]));
    `,
    `
        CREATE INDEX idx_file_type_created_desc ON public.file USING btree (type, created);
    `,
    `
        CREATE UNIQUE INDEX idx_flow_approval_request_flow_id_pending ON public.flow_approval_request USING btree ("flowId") WHERE ((state)::text = 'PENDING'::text);
    `,
    `
        CREATE INDEX idx_flow_approval_request_flow_id_state ON public.flow_approval_request USING btree ("flowId", state);
    `,
    `
        CREATE INDEX idx_flow_approval_request_flow_version_id ON public.flow_approval_request USING btree ("flowVersionId");
    `,
    `
        CREATE INDEX idx_flow_approval_request_platform_id_state ON public.flow_approval_request USING btree ("platformId", state);
    `,
    `
        CREATE INDEX idx_flow_approval_request_project_id_state_created ON public.flow_approval_request USING btree ("projectId", state, created);
    `,
    `
        CREATE INDEX idx_flow_deleting_updated ON public.flow USING btree (updated) WHERE (("operationStatus")::text = 'DELETING'::text);
    `,
    `
        CREATE INDEX idx_flow_folder_id ON public.flow USING btree ("folderId");
    `,
    `
        CREATE UNIQUE INDEX idx_flow_instance_project_id_flow_id ON public."DELETED_flow_instance" USING btree ("projectId", "flowId");
    `,
    `
        CREATE INDEX idx_flow_owner_id ON public.flow USING btree ("ownerId");
    `,
    `
        CREATE INDEX idx_flow_project_id ON public.flow USING btree ("projectId");
    `,
    `
        CREATE UNIQUE INDEX idx_flow_project_id_external_id ON public.flow USING btree ("projectId", "externalId") WHERE (("operationStatus")::text <> 'DELETING'::text);
    `,
    `
        CREATE INDEX idx_flow_project_id_status ON public.flow USING btree ("projectId", status);
    `,
    `
        CREATE INDEX idx_flow_template_pieces ON public.flow_template USING btree (pieces);
    `,
    `
        CREATE INDEX idx_flow_template_tags ON public.flow_template USING btree (tags);
    `,
    `
        CREATE INDEX idx_flow_version_connection_ids_gin ON public.flow_version USING gin ("connectionIds");
    `,
    `
        CREATE INDEX idx_flow_version_flow_id_created_desc ON public.flow_version USING btree ("flowId", created DESC);
    `,
    `
        CREATE INDEX idx_flow_version_schema_version ON public.flow_version USING btree ("schemaVersion");
    `,
    `
        CREATE INDEX idx_flow_version_updated_by ON public.flow_version USING btree ("updatedBy");
    `,
    `
        CREATE INDEX idx_flow_worker_group ON public.flow USING btree ("workerGroupId");
    `,
    `
        CREATE UNIQUE INDEX idx_folder_project_id_display_name ON public.folder USING btree ("projectId", "displayName");
    `,
    `
        CREATE UNIQUE INDEX idx_folder_project_id_external_id ON public.folder USING btree ("projectId", "externalId") WHERE ("externalId" IS NOT NULL);
    `,
    `
        CREATE UNIQUE INDEX idx_git_repo_project_id ON public.git_repo USING btree ("projectId");
    `,
    `
        CREATE UNIQUE INDEX idx_instance_collection_id ON public.instance USING btree ("collectionId");
    `,
    `
        CREATE INDEX idx_instance_project_id ON public.instance USING btree ("projectId");
    `,
    `
        CREATE INDEX idx_kb_chunk_embedding ON public.knowledge_base_chunk USING hnsw (embedding public.vector_cosine_ops);
    `,
    `
        CREATE INDEX idx_kb_chunk_project_file ON public.knowledge_base_chunk USING btree ("projectId", "knowledgeBaseFileId");
    `,
    `
        CREATE UNIQUE INDEX idx_kb_file_file_id ON public.knowledge_base_file USING btree ("fileId");
    `,
    `
        CREATE INDEX idx_kb_file_project_id ON public.knowledge_base_file USING btree ("projectId");
    `,
    `
        CREATE INDEX idx_mcp_activity_created_id ON public.mcp_activity USING btree (created, id);
    `,
    `
        CREATE INDEX idx_mcp_activity_payload_file_id ON public.mcp_activity USING btree ("payloadFileId");
    `,
    `
        CREATE INDEX idx_mcp_activity_platform_id_client_key_created_id ON public.mcp_activity USING btree ("platformId", "clientKey", created, id);
    `,
    `
        CREATE INDEX idx_mcp_activity_platform_id_created_id ON public.mcp_activity USING btree ("platformId", created, id);
    `,
    `
        CREATE INDEX idx_mcp_activity_platform_id_status_created_id ON public.mcp_activity USING btree ("platformId", status, created, id);
    `,
    `
        CREATE INDEX idx_mcp_activity_platform_id_user_id_created_id ON public.mcp_activity USING btree ("platformId", "userId", created, id);
    `,
    `
        CREATE INDEX idx_mcp_activity_project_id_created_id ON public.mcp_activity USING btree ("projectId", created, id);
    `,
    `
        CREATE UNIQUE INDEX idx_mcp_oauth_client_client_id ON public.mcp_oauth_client USING btree ("clientId");
    `,
    `
        CREATE UNIQUE INDEX idx_mcp_oauth_code ON public.mcp_oauth_authorization_code USING btree (code);
    `,
    `
        CREATE INDEX idx_mcp_oauth_token_platform_user_revoked_created ON public.mcp_oauth_token USING btree ("platformId", "userId", revoked, created);
    `,
    `
        CREATE UNIQUE INDEX idx_mcp_oauth_token_refresh ON public.mcp_oauth_token USING btree ("refreshToken");
    `,
    `
        CREATE UNIQUE INDEX idx_mcp_server_platform_id ON public.mcp_server USING btree ("platformId");
    `,
    `
        CREATE UNIQUE INDEX idx_mcp_server_token ON public.mcp_server USING btree (token);
    `,
    `
        CREATE INDEX idx_mcp_tool_flow_id ON public.mcp_tool USING btree ("flowId");
    `,
    `
        CREATE INDEX idx_mcp_tool_mcp_id ON public.mcp_tool USING btree ("mcpId");
    `,
    `
        CREATE UNIQUE INDEX "idx_oauth_app_platformId_pieceName" ON public.oauth_app USING btree ("platformId", "pieceName");
    `,
    `
        CREATE UNIQUE INDEX idx_otp_identity_id_type ON public.otp USING btree ("identityId", type);
    `,
    `
        CREATE UNIQUE INDEX idx_piece_metadata_name_platform_id_version ON public.piece_metadata USING btree (name, version, "platformId");
    `,
    `
        CREATE INDEX idx_piece_set_platform_id_created_id ON public.piece_set USING btree ("platformId", created, id);
    `,
    `
        CREATE UNIQUE INDEX idx_piece_set_platform_id_is_default ON public.piece_set USING btree ("platformId") WHERE ("isDefault" = true);
    `,
    `
        CREATE UNIQUE INDEX idx_piece_set_platform_id_key ON public.piece_set USING btree ("platformId", key) WHERE (key IS NOT NULL);
    `,
    `
        CREATE UNIQUE INDEX idx_plan_project_id ON public.project_plan USING btree ("projectId");
    `,
    `
        CREATE INDEX idx_platform_analytics_report_platform_id ON public.platform_analytics_report USING btree ("platformId");
    `,
    `
        CREATE UNIQUE INDEX idx_platform_configuration_platform_id ON public.platform_configuration USING btree ("platformId");
    `,
    `
        CREATE UNIQUE INDEX idx_platform_model_tier_platform_default ON public.platform_model_tier USING btree ("platformId") WHERE (("isDefault" = true) AND (deleted IS NULL));
    `,
    `
        CREATE UNIQUE INDEX idx_platform_model_tier_platform_fast ON public.platform_model_tier USING btree ("platformId") WHERE (("isFast" = true) AND (deleted IS NULL));
    `,
    `
        CREATE INDEX idx_platform_model_tier_platform_id ON public.platform_model_tier USING btree ("platformId");
    `,
    `
        CREATE UNIQUE INDEX idx_platform_model_tier_platform_name_live ON public.platform_model_tier USING btree ("platformId", lower((name)::text)) WHERE (deleted IS NULL);
    `,
    `
        CREATE UNIQUE INDEX idx_platform_plan_platform_id ON public.platform_plan USING btree ("platformId");
    `,
    `
        CREATE INDEX idx_platform_plan_worker_group_id ON public.platform_plan USING btree ("workerGroupId") WHERE ("workerGroupId" IS NOT NULL);
    `,
    `
        CREATE UNIQUE INDEX idx_platform_sso_domain ON public.platform USING btree ("ssoDomain") WHERE ("ssoDomain" IS NOT NULL);
    `,
    `
        CREATE INDEX idx_project_execution_data_retention_days ON public.project USING btree ("executionDataRetentionDays") WHERE ("executionDataRetentionDays" IS NOT NULL);
    `,
    `
        CREATE UNIQUE INDEX idx_project_member_project_id_user_id_platform_id ON public.project_member USING btree ("projectId", "userId", "platformId");
    `,
    `
        CREATE INDEX idx_project_owner_id ON public.project USING btree ("ownerId");
    `,
    `
        CREATE INDEX idx_project_piece_set_id ON public.project USING btree ("pieceSetId");
    `,
    `
        CREATE INDEX idx_project_platform_id ON public.project USING btree ("platformId");
    `,
    `
        CREATE UNIQUE INDEX idx_project_platform_id_external_id ON public.project USING btree ("platformId", "externalId") WHERE (deleted IS NULL);
    `,
    `
        CREATE INDEX idx_project_pool_id ON public.project USING btree ("poolId");
    `,
    `
        CREATE INDEX idx_project_release_project_id ON public.project_release USING btree ("projectId");
    `,
    `
        CREATE UNIQUE INDEX idx_project_role_platform_id_name ON public.project_role USING btree ("platformId", lower((name)::text)) WHERE ("platformId" IS NOT NULL);
    `,
    `
        CREATE INDEX idx_project_usage_project_id ON public.project_usage USING btree ("projectId");
    `,
    `
        CREATE INDEX idx_project_worker_group ON public.project USING btree ("workerGroupId");
    `,
    `
        CREATE INDEX idx_record_project_id_table_id ON public.record USING btree ("projectId", "tableId");
    `,
    `
        CREATE INDEX idx_record_table_id_project_id_record_id ON public.record USING btree ("tableId", "projectId", id);
    `,
    `
        CREATE INDEX idx_run_flow_id ON public.flow_run USING btree ("flowId");
    `,
    `
        CREATE INDEX idx_run_flow_version_id ON public.flow_run USING btree ("flowVersionId");
    `,
    `
        CREATE INDEX idx_run_logs_file_id ON public.flow_run USING btree ("logsFileId");
    `,
    `
        CREATE INDEX idx_run_parent_run_id ON public.flow_run USING btree ("parentRunId");
    `,
    `
        CREATE INDEX idx_run_parent_waitpoint_id ON public.flow_run USING btree ("parentWaitpointId", "projectId", "dispatchIndex", status) WHERE ("parentWaitpointId" IS NOT NULL);
    `,
    `
        CREATE INDEX idx_run_project_env_created_archived_status_parent_waitpoint ON public.flow_run USING btree ("projectId", environment, created DESC, "archivedAt", status) WHERE ("parentWaitpointId" IS NULL);
    `,
    `
        CREATE INDEX idx_run_project_env_flow_created_archived_parent_waitpoint ON public.flow_run USING btree ("projectId", environment, "flowId", created DESC, "archivedAt") WHERE ("parentWaitpointId" IS NULL);
    `,
    `
        CREATE INDEX idx_run_project_env_flow_status_created_parent_waitpoint ON public.flow_run USING btree ("projectId", environment, "flowId", status, created DESC, "archivedAt") WHERE ("parentWaitpointId" IS NULL);
    `,
    `
        CREATE INDEX idx_run_project_env_status_created_archived_parent_waitpoint ON public.flow_run USING btree ("projectId", environment, status, created DESC, "archivedAt", "parentWaitpointId");
    `,
    `
        CREATE INDEX idx_run_project_id_environment_created_status_archived_at ON public.flow_run USING btree ("projectId", environment, created DESC, "archivedAt", status);
    `,
    `
        CREATE INDEX idx_run_project_id_environment_flow_id_created_archived_at ON public.flow_run USING btree ("projectId", environment, "flowId", created DESC, "archivedAt");
    `,
    `
        CREATE INDEX idx_run_project_id_environment_flow_id_status_created_archived_ ON public.flow_run USING btree ("projectId", environment, "flowId", status, created DESC, "archivedAt");
    `,
    `
        CREATE INDEX idx_run_project_id_environment_status_created_archived_at ON public.flow_run USING btree ("projectId", environment, status, created DESC, "archivedAt");
    `,
    `
        CREATE INDEX idx_run_triggered_by ON public.flow_run USING btree ("triggeredBy");
    `,
    `
        CREATE INDEX idx_secret_manager_connection_platform_id ON public.secret_manager_connection USING btree ("platformId");
    `,
    `
        CREATE INDEX idx_table_folder_id ON public."table" USING btree ("folderId");
    `,
    `
        CREATE INDEX idx_table_project_id_name ON public."table" USING btree ("projectId", name);
    `,
    `
        CREATE INDEX idx_table_webhook_flow_id ON public.table_webhook USING btree ("flowId");
    `,
    `
        CREATE INDEX idx_template_categories ON public.template USING btree (categories);
    `,
    `
        CREATE INDEX idx_template_pieces ON public.template USING btree (pieces);
    `,
    `
        CREATE INDEX idx_template_platform_id ON public.template USING btree ("platformId");
    `,
    `
        CREATE INDEX idx_todo_activity_todo_id ON public.todo_activity USING btree ("todoId");
    `,
    `
        CREATE INDEX idx_todo_activity_user_id ON public.todo_activity USING btree ("userId");
    `,
    `
        CREATE INDEX idx_todo_comment_todo_id ON public.todo_comment USING btree ("todoId");
    `,
    `
        CREATE INDEX idx_todo_comment_user_id ON public.todo_comment USING btree ("userId");
    `,
    `
        CREATE INDEX idx_todo_flow_id ON public.todo USING btree ("flowId");
    `,
    `
        CREATE INDEX idx_todo_platform_id ON public.todo USING btree ("platformId");
    `,
    `
        CREATE INDEX idx_todo_project_id ON public.todo USING btree ("projectId");
    `,
    `
        CREATE UNIQUE INDEX idx_trigger_event_file_id ON public.trigger_event USING btree ("fileId");
    `,
    `
        CREATE INDEX idx_trigger_event_flow_id ON public.trigger_event USING btree ("flowId");
    `,
    `
        CREATE INDEX idx_trigger_event_project_id_flow_id ON public.trigger_event USING btree ("projectId", "flowId");
    `,
    `
        CREATE INDEX idx_trigger_flow_id ON public.trigger_source USING btree ("flowId");
    `,
    `
        CREATE UNIQUE INDEX idx_trigger_flow_id_simulate ON public.trigger_source USING btree ("flowId", simulate) WHERE (deleted IS NULL);
    `,
    `
        CREATE INDEX idx_trigger_flow_version_id ON public.trigger_source USING btree ("flowVersionId") WHERE (deleted IS NULL);
    `,
    `
        CREATE INDEX idx_trigger_project_id ON public.trigger_source USING btree ("projectId");
    `,
    `
        CREATE UNIQUE INDEX idx_trigger_project_id_flow_id_simulate ON public.trigger_source USING btree ("projectId", "flowId", simulate) WHERE (deleted IS NULL);
    `,
    `
        CREATE UNIQUE INDEX idx_trigger_run_job_id ON public.trigger_run USING btree ("jobId");
    `,
    `
        CREATE INDEX idx_trigger_run_payload_file_id ON public.trigger_run USING btree ("payloadFileId");
    `,
    `
        CREATE INDEX idx_trigger_run_project_id_trigger_source_id_status ON public.trigger_run USING btree ("projectId", "triggerSourceId");
    `,
    `
        CREATE INDEX idx_trigger_run_trigger_source_id ON public.trigger_run USING btree ("triggerSourceId");
    `,
    `
        CREATE INDEX idx_tsi_filters ON public.tool_search_index USING btree ("objectKind", "platformId", audience, "requiresConnection");
    `,
    `
        CREATE UNIQUE INDEX idx_user_identity_email ON public.user_identity USING btree (email);
    `,
    `
        CREATE INDEX idx_user_identity_id ON public."user" USING btree ("identityId");
    `,
    `
        CREATE UNIQUE INDEX idx_user_invitation_email_platform_project ON public.user_invitation USING btree (email, "platformId", "projectId");
    `,
    `
        CREATE UNIQUE INDEX idx_user_memory_platform_user ON public.user_memory USING btree ("platformId", "userId");
    `,
    `
        CREATE UNIQUE INDEX idx_user_platform_id_email ON public."user" USING btree ("platformId", "identityId");
    `,
    `
        CREATE UNIQUE INDEX idx_user_platform_id_external_id ON public."user" USING btree ("platformId", "externalId");
    `,
    `
        CREATE INDEX idx_variable_owner_id ON public.variable USING btree ("ownerId");
    `,
    `
        CREATE UNIQUE INDEX idx_variable_project_id_and_name ON public.variable USING btree ("projectId", name);
    `,
    `
        CREATE INDEX idx_waitpoint_flow_run_id_status_created ON public.waitpoint USING btree ("flowRunId", status, created);
    `,
    `
        CREATE UNIQUE INDEX idx_waitpoint_flow_run_id_step_name ON public.waitpoint USING btree ("flowRunId", "stepName");
    `,
    `
        CREATE INDEX idx_waitpoint_live_deadline ON public.waitpoint USING btree ("resumeDateTime", id) WHERE (((status)::text = 'PENDING'::text) AND ("resumeDateTime" IS NOT NULL) AND ("deadLetteredAt" IS NULL));
    `,
    `
        CREATE INDEX idx_waitpoint_project_id ON public.waitpoint USING btree ("projectId");
    `,
    `
        CREATE INDEX idx_waitpoint_signal_ref_id ON public.waitpoint_signal USING btree ("refId", "projectId") WHERE ("refId" IS NOT NULL);
    `,
    `
        CREATE INDEX idx_waitpoint_signal_waitpoint_id_project_id_sequence ON public.waitpoint_signal USING btree ("waitpointId", "projectId", sequence, created);
    `,
    `
        CREATE INDEX idx_waitpoint_signal_waitpoint_id_project_id_status ON public.waitpoint_signal USING btree ("waitpointId", "projectId", status);
    `,
    `
        CREATE UNIQUE INDEX idx_waitpoint_signal_waitpoint_id_sequence ON public.waitpoint_signal USING btree ("waitpointId", sequence) WHERE (sequence IS NOT NULL);
    `,
    `
        CREATE INDEX idx_waitpoint_undelivered_barrier ON public.waitpoint USING btree (updated, id) WHERE (((type)::text = 'BARRIER'::text) AND ((status)::text = 'COMPLETED'::text));
    `,
    `
        CREATE UNIQUE INDEX idx_webhook_simulation_flow_id ON public.webhook_simulation USING btree ("flowId");
    `,
    `
        CREATE UNIQUE INDEX mcp_project_id_external_id ON public.mcp USING btree ("projectId", "externalId");
    `,
    `
        CREATE UNIQUE INDEX mcp_server_project_id ON public.mcp_server USING btree ("projectId");
    `,
    `
        CREATE INDEX step_file_project_id_flow_id_step_name_name ON public.step_file USING btree ("projectId", "flowId", "stepName", name);
    `,
    `
        CREATE UNIQUE INDEX uq_tsi_object_shared ON public.tool_search_index USING btree ("pieceName", "objectKind", "objectName", "modelVersion") WHERE ("platformId" IS NULL);
    `,
    `
        CREATE UNIQUE INDEX uq_tsi_object_tenant ON public.tool_search_index USING btree ("pieceName", "objectKind", "objectName", "platformId", "modelVersion") WHERE ("platformId" IS NOT NULL);
    `,
    `
        ALTER TABLE ONLY public.connection_key
            ADD CONSTRAINT "FK_03177dc6779e6e147866d43c050" FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.trigger_source
            ADD CONSTRAINT "FK_3d3024c914f2fbf4f9e25029816" FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.mcp_tool
            ADD CONSTRAINT "FK_3f26c7b876fba48b9e90efb3d79" FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.trigger_source
            ADD CONSTRAINT "FK_5f28d74a4fdaf3fc91e6a0e7450" FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.audit_event
            ADD CONSTRAINT "FK_8188cdbf5c16c58d431efddd451" FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo
            ADD CONSTRAINT "FK_c79681af2867d6f762d94b885a9" FOREIGN KEY ("createdByUserId") REFERENCES public."user"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.app_credential
            ADD CONSTRAINT "FK_d82bfb4c7432a69dc2419083a0e" FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.mcp_server
            ADD CONSTRAINT "FK_dd85c7c51f3c8137aecb1cafd34" FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public."user"
            ADD CONSTRAINT "FK_dea97e26c765a4cdb575957a146" FOREIGN KEY ("identityId") REFERENCES public.user_identity(id);
    `,
    `
        ALTER TABLE ONLY public.mcp_tool
            ADD CONSTRAINT "FK_ff5eb8d6e2b6375d0d98569d5fb" FOREIGN KEY ("mcpId") REFERENCES public.mcp(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.agent_conversation
            ADD CONSTRAINT fk_agent_conversation_agent_id FOREIGN KEY ("agentId") REFERENCES public.agent(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.agent_conversation
            ADD CONSTRAINT fk_agent_conversation_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.agent_conversation
            ADD CONSTRAINT fk_agent_conversation_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.agent_conversation
            ADD CONSTRAINT fk_agent_conversation_user_id FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.agent
            ADD CONSTRAINT fk_agent_folder_id FOREIGN KEY ("folderId") REFERENCES public.folder(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.agent
            ADD CONSTRAINT fk_agent_owner_id FOREIGN KEY ("ownerId") REFERENCES public."user"(id);
    `,
    `
        ALTER TABLE ONLY public.agent
            ADD CONSTRAINT fk_agent_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.agent_task
            ADD CONSTRAINT fk_agent_task_conversation_id FOREIGN KEY ("conversationId") REFERENCES public.agent_conversation(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.agent_task
            ADD CONSTRAINT fk_agent_task_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.ai_provider
            ADD CONSTRAINT fk_ai_provider_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.ai_tool_config
            ADD CONSTRAINT fk_ai_tool_config_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.ai_usage_copy_cursor
            ADD CONSTRAINT fk_ai_usage_copy_cursor_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.ai_usage_daily
            ADD CONSTRAINT fk_ai_usage_daily_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.api_key
            ADD CONSTRAINT fk_api_key_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.app_connection
            ADD CONSTRAINT fk_app_connection_owner_id FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.cell
            ADD CONSTRAINT fk_cell_field_id FOREIGN KEY ("fieldId") REFERENCES public.field(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.cell
            ADD CONSTRAINT fk_cell_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.cell
            ADD CONSTRAINT fk_cell_record_id FOREIGN KEY ("recordId") REFERENCES public.record(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.chat_personalization
            ADD CONSTRAINT fk_chat_personalization_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.chat_personalization
            ADD CONSTRAINT fk_chat_personalization_user_id FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.collection
            ADD CONSTRAINT fk_collection_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.collection_version
            ADD CONSTRAINT fk_collection_version_collection_id FOREIGN KEY ("collectionId") REFERENCES public.collection(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.custom_domain
            ADD CONSTRAINT fk_custom_domain_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.embed_subdomain
            ADD CONSTRAINT fk_embed_subdomain_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.event_destination
            ADD CONSTRAINT fk_event_destination_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.event_destination
            ADD CONSTRAINT fk_event_destination_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.field
            ADD CONSTRAINT fk_field_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.field
            ADD CONSTRAINT fk_field_table_id FOREIGN KEY ("tableId") REFERENCES public."table"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.file
            ADD CONSTRAINT fk_file_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow_approval_request
            ADD CONSTRAINT fk_flow_approval_request_approver_id FOREIGN KEY ("approverId") REFERENCES public."user"(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.flow_approval_request
            ADD CONSTRAINT fk_flow_approval_request_flow_id FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow_approval_request
            ADD CONSTRAINT fk_flow_approval_request_flow_version_id FOREIGN KEY ("flowVersionId") REFERENCES public.flow_version(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow_approval_request
            ADD CONSTRAINT fk_flow_approval_request_submitter_id FOREIGN KEY ("submitterId") REFERENCES public."user"(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.flow
            ADD CONSTRAINT fk_flow_folder_id FOREIGN KEY ("folderId") REFERENCES public.folder(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public."DELETED_flow_instance"
            ADD CONSTRAINT fk_flow_instance_flow FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public."DELETED_flow_instance"
            ADD CONSTRAINT fk_flow_instance_flow_version FOREIGN KEY ("flowVersionId") REFERENCES public.flow_version(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow
            ADD CONSTRAINT fk_flow_owner_id FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.flow
            ADD CONSTRAINT fk_flow_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow
            ADD CONSTRAINT fk_flow_published_version FOREIGN KEY ("publishedVersionId") REFERENCES public.flow_version(id) ON DELETE RESTRICT;
    `,
    `
        ALTER TABLE ONLY public.flow_run
            ADD CONSTRAINT fk_flow_run_flow_id FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow_run
            ADD CONSTRAINT fk_flow_run_flow_version_id FOREIGN KEY ("flowVersionId") REFERENCES public.flow_version(id) ON DELETE CASCADE NOT VALID;
    `,
    `
        ALTER TABLE ONLY public.flow_run
            ADD CONSTRAINT fk_flow_run_logs_file_id FOREIGN KEY ("logsFileId") REFERENCES public.file(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.flow_run
            ADD CONSTRAINT fk_flow_run_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow_run
            ADD CONSTRAINT fk_flow_run_triggered_by_user_id FOREIGN KEY ("triggeredBy") REFERENCES public."user"(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.flow_template
            ADD CONSTRAINT fk_flow_template_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow_template
            ADD CONSTRAINT fk_flow_template_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow_version
            ADD CONSTRAINT fk_flow_version_flow FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.folder
            ADD CONSTRAINT fk_folder_project FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.git_repo
            ADD CONSTRAINT fk_git_repo_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.instance
            ADD CONSTRAINT fk_instance_collection FOREIGN KEY ("collectionId") REFERENCES public.collection(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.knowledge_base_chunk
            ADD CONSTRAINT fk_kb_chunk_kb_file_id FOREIGN KEY ("knowledgeBaseFileId") REFERENCES public.knowledge_base_file(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.knowledge_base_file
            ADD CONSTRAINT fk_kb_file_file_id FOREIGN KEY ("fileId") REFERENCES public.file(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.knowledge_base_file
            ADD CONSTRAINT fk_kb_file_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.mcp_activity
            ADD CONSTRAINT fk_mcp_activity_payload_file_id FOREIGN KEY ("payloadFileId") REFERENCES public.file(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.mcp_activity
            ADD CONSTRAINT fk_mcp_activity_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.mcp_activity
            ADD CONSTRAINT fk_mcp_activity_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.mcp_server
            ADD CONSTRAINT fk_mcp_server_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.oauth_app
            ADD CONSTRAINT fk_oauth_app_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.otp
            ADD CONSTRAINT fk_otp_identity_id FOREIGN KEY ("identityId") REFERENCES public.user_identity(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.piece_metadata
            ADD CONSTRAINT fk_piece_metadata_file FOREIGN KEY ("archiveId") REFERENCES public.file(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
    `,
    `
        ALTER TABLE ONLY public.piece_set
            ADD CONSTRAINT fk_piece_set_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.piece_translation
            ADD CONSTRAINT fk_piece_translation_piece_metadata_id FOREIGN KEY ("pieceMetadataId") REFERENCES public.piece_metadata(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.platform_analytics_report
            ADD CONSTRAINT fk_platform_analytics_report_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.platform_configuration
            ADD CONSTRAINT fk_platform_configuration_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.platform_model_tier
            ADD CONSTRAINT fk_platform_model_tier_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.platform_plan
            ADD CONSTRAINT fk_platform_plan_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.platform
            ADD CONSTRAINT fk_platform_user FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
    `,
    `
        ALTER TABLE ONLY public.project_member
            ADD CONSTRAINT fk_project_member_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.project_member
            ADD CONSTRAINT fk_project_member_project_role_id FOREIGN KEY ("projectRoleId") REFERENCES public.project_role(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.project_member
            ADD CONSTRAINT fk_project_member_user_id FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.project
            ADD CONSTRAINT fk_project_owner_id FOREIGN KEY ("ownerId") REFERENCES public."user"(id);
    `,
    `
        ALTER TABLE ONLY public.project_plan
            ADD CONSTRAINT fk_project_plan_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.project
            ADD CONSTRAINT fk_project_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
    `,
    `
        ALTER TABLE ONLY public.project_release
            ADD CONSTRAINT fk_project_release_file_id FOREIGN KEY ("fileId") REFERENCES public.file(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.project_release
            ADD CONSTRAINT fk_project_release_imported_by FOREIGN KEY ("importedBy") REFERENCES public."user"(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.project_release
            ADD CONSTRAINT fk_project_release_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.project_usage
            ADD CONSTRAINT fk_project_usage_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.record
            ADD CONSTRAINT fk_record_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.record
            ADD CONSTRAINT fk_record_table_id FOREIGN KEY ("tableId") REFERENCES public."table"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.secret_manager_connection
            ADD CONSTRAINT fk_secret_manager_connection_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.signing_key
            ADD CONSTRAINT fk_signing_key_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
    `,
    `
        ALTER TABLE ONLY public.step_file
            ADD CONSTRAINT fk_step_file_flow_id FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.step_file
            ADD CONSTRAINT fk_step_file_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public."table"
            ADD CONSTRAINT fk_table_folder_id FOREIGN KEY ("folderId") REFERENCES public.folder(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public."table"
            ADD CONSTRAINT fk_table_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.table_webhook
            ADD CONSTRAINT fk_table_webhook_flow_id FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.table_webhook
            ADD CONSTRAINT fk_table_webhook_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.table_webhook
            ADD CONSTRAINT fk_table_webhook_table_id FOREIGN KEY ("tableId") REFERENCES public."table"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.template
            ADD CONSTRAINT fk_template_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo_activity
            ADD CONSTRAINT fk_todo_activity_todo_id FOREIGN KEY ("todoId") REFERENCES public.todo(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo_activity
            ADD CONSTRAINT fk_todo_activity_user_id FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo
            ADD CONSTRAINT fk_todo_assignee_id FOREIGN KEY ("assigneeId") REFERENCES public."user"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo_comment
            ADD CONSTRAINT fk_todo_comment_todo_id FOREIGN KEY ("todoId") REFERENCES public.todo(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo_comment
            ADD CONSTRAINT fk_todo_comment_user_id FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo
            ADD CONSTRAINT fk_todo_flow_id FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo
            ADD CONSTRAINT fk_todo_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo
            ADD CONSTRAINT fk_todo_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.todo
            ADD CONSTRAINT fk_todo_run_id FOREIGN KEY ("runId") REFERENCES public.flow_run(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.trigger_event
            ADD CONSTRAINT fk_trigger_event_file_id FOREIGN KEY ("fileId") REFERENCES public.file(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.trigger_event
            ADD CONSTRAINT fk_trigger_event_flow_id FOREIGN KEY ("flowId") REFERENCES public.flow(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.trigger_event
            ADD CONSTRAINT fk_trigger_event_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.trigger_run
            ADD CONSTRAINT fk_trigger_run_payload_file_id FOREIGN KEY ("payloadFileId") REFERENCES public.file(id) ON DELETE CASCADE NOT VALID;
    `,
    `
        ALTER TABLE ONLY public.trigger_run
            ADD CONSTRAINT fk_trigger_run_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.trigger_run
            ADD CONSTRAINT fk_trigger_run_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.trigger_run
            ADD CONSTRAINT fk_trigger_run_trigger_source_id FOREIGN KEY ("triggerSourceId") REFERENCES public.trigger_source(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.flow_version
            ADD CONSTRAINT fk_updated_by_user_flow FOREIGN KEY ("updatedBy") REFERENCES public."user"(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.user_invitation
            ADD CONSTRAINT fk_user_invitation_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.user_memory
            ADD CONSTRAINT fk_user_memory_platform_id FOREIGN KEY ("platformId") REFERENCES public.platform(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.user_memory
            ADD CONSTRAINT fk_user_memory_user_id FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.variable
            ADD CONSTRAINT fk_variable_owner_id FOREIGN KEY ("ownerId") REFERENCES public."user"(id) ON DELETE SET NULL;
    `,
    `
        ALTER TABLE ONLY public.waitpoint
            ADD CONSTRAINT fk_waitpoint_project_id FOREIGN KEY ("projectId") REFERENCES public.project(id) ON DELETE CASCADE;
    `,
    `
        ALTER TABLE ONLY public.waitpoint_signal
            ADD CONSTRAINT fk_waitpoint_signal_waitpoint_id FOREIGN KEY ("waitpointId") REFERENCES public.waitpoint(id) ON DELETE CASCADE;
    `,
]
