import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddUserMfa1880000000001 implements Migration {
    name = 'AddUserMfa1880000000001'
    breaking = false
    release = '0.93.0'
    transaction = true

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "user_mfa" (
                "id" character varying(21) NOT NULL,
                "created" timestamp with time zone NOT NULL DEFAULT now(),
                "updated" timestamp with time zone NOT NULL DEFAULT now(),
                "userId" character varying(21) NOT NULL,
                "platformId" character varying(21) NOT NULL,
                "secret" jsonb NOT NULL,
                "lastUsedStep" integer,
                "recoveryCodeHashes" character varying array NOT NULL,
                CONSTRAINT "pk_user_mfa" PRIMARY KEY ("id")
            )
        `)
        await queryRunner.query('CREATE UNIQUE INDEX "idx_user_mfa_user_id" ON "user_mfa" ("userId")')
        await queryRunner.query('CREATE INDEX "idx_user_mfa_platform_id" ON "user_mfa" ("platformId")')
        await queryRunner.query(`
            ALTER TABLE "user_mfa"
            ADD CONSTRAINT "fk_user_mfa_user_id" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "user_mfa"
            ADD CONSTRAINT "fk_user_mfa_platform_id" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE "user_mfa"')
    }
}
