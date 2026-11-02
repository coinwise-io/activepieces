import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddAccessGrant1880000000002 implements Migration {
    name = 'AddAccessGrant1880000000002'
    breaking = false
    release = '0.93.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "access_grant" (
                "id" character varying(21) NOT NULL,
                "created" timestamp with time zone NOT NULL DEFAULT now(),
                "updated" timestamp with time zone NOT NULL DEFAULT now(),
                "platformId" character varying(21) NOT NULL,
                "projectId" character varying(21) NOT NULL,
                "folderId" character varying(21),
                "flowId" character varying(21),
                "userId" character varying(21),
                "groupId" character varying(21),
                "role" character varying NOT NULL,
                "createdBy" character varying(21),
                CONSTRAINT "pk_access_grant" PRIMARY KEY ("id"),
                CONSTRAINT "chk_access_grant_single_principal" CHECK (("userId" IS NULL) <> ("groupId" IS NULL))
            )
        `)
        await queryRunner.query('CREATE INDEX "idx_access_grant_platform_id" ON "access_grant" ("platformId")')
        await queryRunner.query('CREATE INDEX "idx_access_grant_project_id" ON "access_grant" ("projectId")')
        await queryRunner.query('CREATE INDEX "idx_access_grant_folder_id" ON "access_grant" ("folderId")')
        await queryRunner.query('CREATE INDEX "idx_access_grant_flow_id" ON "access_grant" ("flowId")')
        await queryRunner.query('CREATE INDEX "idx_access_grant_user_id" ON "access_grant" ("userId")')
        await queryRunner.query('CREATE INDEX "idx_access_grant_group_id" ON "access_grant" ("groupId")')
        await queryRunner.query('CREATE UNIQUE INDEX "idx_access_grant_unique_project_user" ON "access_grant" ("projectId", "userId", "role") WHERE "folderId" IS NULL AND "flowId" IS NULL AND "userId" IS NOT NULL')
        await queryRunner.query('CREATE UNIQUE INDEX "idx_access_grant_unique_project_group" ON "access_grant" ("projectId", "groupId", "role") WHERE "folderId" IS NULL AND "flowId" IS NULL AND "groupId" IS NOT NULL')
        await queryRunner.query('CREATE UNIQUE INDEX "idx_access_grant_unique_folder_user" ON "access_grant" ("folderId", "userId", "role") WHERE "folderId" IS NOT NULL AND "userId" IS NOT NULL')
        await queryRunner.query('CREATE UNIQUE INDEX "idx_access_grant_unique_folder_group" ON "access_grant" ("folderId", "groupId", "role") WHERE "folderId" IS NOT NULL AND "groupId" IS NOT NULL')
        await queryRunner.query('CREATE UNIQUE INDEX "idx_access_grant_unique_flow_user" ON "access_grant" ("flowId", "userId", "role") WHERE "flowId" IS NOT NULL AND "userId" IS NOT NULL')
        await queryRunner.query('CREATE UNIQUE INDEX "idx_access_grant_unique_flow_group" ON "access_grant" ("flowId", "groupId", "role") WHERE "flowId" IS NOT NULL AND "groupId" IS NOT NULL')
        await queryRunner.query(`
            ALTER TABLE "access_grant"
            ADD CONSTRAINT "fk_access_grant_platform_id" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "access_grant"
            ADD CONSTRAINT "fk_access_grant_project_id" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "access_grant"
            ADD CONSTRAINT "fk_access_grant_folder_id" FOREIGN KEY ("folderId") REFERENCES "folder"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "access_grant"
            ADD CONSTRAINT "fk_access_grant_flow_id" FOREIGN KEY ("flowId") REFERENCES "flow"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "access_grant"
            ADD CONSTRAINT "fk_access_grant_user_id" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "access_grant"
            ADD CONSTRAINT "fk_access_grant_group_id" FOREIGN KEY ("groupId") REFERENCES "user_group"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "access_grant"
            ADD CONSTRAINT "fk_access_grant_created_by" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE "access_grant"')
    }
}
