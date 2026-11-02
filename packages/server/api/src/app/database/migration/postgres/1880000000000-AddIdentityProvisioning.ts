import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddIdentityProvisioning1880000000000 implements Migration {
    name = 'AddIdentityProvisioning1880000000000'
    breaking = false
    release = '0.93.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "scim_token" (
                "id" character varying(21) NOT NULL,
                "created" timestamp with time zone NOT NULL DEFAULT now(),
                "updated" timestamp with time zone NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "displayName" character varying NOT NULL,
                "tokenHash" character varying NOT NULL,
                "lastUsedAt" timestamp with time zone,
                CONSTRAINT "pk_scim_token" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query('CREATE INDEX "idx_scim_token_platform_id" ON "scim_token" ("platformId")')
        await queryRunner.query('CREATE UNIQUE INDEX "idx_scim_token_token_hash" ON "scim_token" ("tokenHash")')
        await queryRunner.query(`
            ALTER TABLE "scim_token"
            ADD CONSTRAINT "fk_scim_token_platform_id" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)

        await queryRunner.query(`
            CREATE TABLE "user_group" (
                "id" character varying(21) NOT NULL,
                "created" timestamp with time zone NOT NULL DEFAULT now(),
                "updated" timestamp with time zone NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "displayName" character varying NOT NULL,
                "externalId" character varying,
                CONSTRAINT "pk_user_group" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query('CREATE INDEX "idx_user_group_platform_id" ON "user_group" ("platformId")')
        await queryRunner.query('CREATE UNIQUE INDEX "idx_user_group_platform_id_display_name" ON "user_group" ("platformId", "displayName")')
        await queryRunner.query('CREATE UNIQUE INDEX "idx_user_group_platform_id_external_id" ON "user_group" ("platformId", "externalId") WHERE "externalId" IS NOT NULL')
        await queryRunner.query(`
            ALTER TABLE "user_group"
            ADD CONSTRAINT "fk_user_group_platform_id" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)

        await queryRunner.query(`
            CREATE TABLE "user_group_member" (
                "id" character varying(21) NOT NULL,
                "created" timestamp with time zone NOT NULL DEFAULT now(),
                "groupId" character varying(21) NOT NULL,
                "userId" character varying(21) NOT NULL,
                CONSTRAINT "pk_user_group_member" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query('CREATE UNIQUE INDEX "idx_user_group_member_group_id_user_id" ON "user_group_member" ("groupId", "userId")')
        await queryRunner.query('CREATE INDEX "idx_user_group_member_user_id" ON "user_group_member" ("userId")')
        await queryRunner.query(`
            ALTER TABLE "user_group_member"
            ADD CONSTRAINT "fk_user_group_member_group_id" FOREIGN KEY ("groupId") REFERENCES "user_group"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "user_group_member"
            ADD CONSTRAINT "fk_user_group_member_user_id" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE "user_group_member"')
        await queryRunner.query('DROP TABLE "user_group"')
        await queryRunner.query('DROP TABLE "scim_token"')
    }
}
