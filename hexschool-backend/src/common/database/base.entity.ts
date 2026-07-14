import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Global-conventions abstract entity (roadmap "Database — all tables"):
 * UUID PK, audit timestamps, actor columns, soft delete.
 *
 * TypeORM's `DeleteDateColumn` gives us automatic soft-delete scoping:
 * every default find excludes rows with `deleted_at` set.
 */
export abstract class AppBaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}

/**
 * Multi-school-ready base: every business table carries `school_id` from
 * day one (Module 31 activates real multi-tenancy without schema surgery).
 * Join/log tables that must not soft-delete extend nothing.
 */
export abstract class SchoolScopedEntity extends AppBaseEntity {
  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;
}
