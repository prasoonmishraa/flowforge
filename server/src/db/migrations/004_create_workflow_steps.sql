CREATE TABLE workflow_steps (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    workflow_id BIGINT NOT NULL
        REFERENCES workflows(id)
        ON DELETE CASCADE,

    name VARCHAR(150) NOT NULL
        CHECK (BTRIM(name) <> ''),

    step_type VARCHAR(100) NOT NULL
        CHECK (BTRIM(step_type) <> ''),

    config JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(config) = 'object'),

    position INTEGER NOT NULL
        CHECK (position > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT workflow_steps_workflow_position_unique
        UNIQUE (workflow_id, position),

    CONSTRAINT workflow_steps_workflow_id_id_unique
        UNIQUE (workflow_id, id)
);


CREATE TABLE workflow_step_dependencies (
    workflow_id BIGINT NOT NULL,

    step_id BIGINT NOT NULL,

    depends_on_step_id BIGINT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT workflow_step_dependencies_pkey
        PRIMARY KEY (workflow_id, step_id, depends_on_step_id),

    CONSTRAINT workflow_step_dependencies_step_fk
        FOREIGN KEY (workflow_id, step_id)
        REFERENCES workflow_steps(workflow_id, id)
        ON DELETE CASCADE,

    CONSTRAINT workflow_step_dependencies_predecessor_fk
        FOREIGN KEY (workflow_id, depends_on_step_id)
        REFERENCES workflow_steps(workflow_id, id)
        ON DELETE CASCADE,

    CONSTRAINT workflow_step_dependencies_no_self_reference
        CHECK (step_id <> depends_on_step_id)
);


CREATE INDEX idx_workflow_step_dependencies_predecessor
    ON workflow_step_dependencies(workflow_id, depends_on_step_id);
