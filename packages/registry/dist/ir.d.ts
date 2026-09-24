/**
 * Policy IR — the ONE typed representation of an Intent Contract.
 *
 *   English ──(LLM, Structured Outputs)──► SurfaceIR ──(validator)──► PolicyIR
 *                                                                        │
 *                       compile ◄── capability coverage ◄────────────────┘
 *
 * SurfaceIR is what the model is allowed to say: free phrases for data types
 * and destinations, every field present (nullable), no enforcement meaning.
 * PolicyIR is what Wrapbox believes: data types and destination classes are
 * REGISTRY REFERENCES, thresholds are policy semantics on the clause, and every
 * protected clause states what happens when a required capability is missing.
 *
 * Both are Zod schemas. The Surface schema is exported as a strict JSON Schema
 * for OpenAI Structured Outputs (all fields required, additionalProperties
 * false); the model producing valid JSON proves the SHAPE, and the validator
 * re-checks the MEANING against the registries.
 */
import { z } from "zod";
export declare const ACTION_VERBS: readonly ["read", "write", "delete", "execute", "query", "push", "merge", "invoke", "disclose", "transact", "configure", "connect", "list"];
export declare const RESOURCE_TYPES: readonly ["file", "folder", "repo", "branch", "database", "dataset", "schema", "table", "column", "db_statement", "endpoint", "api", "mcp_tool", "account", "cloud_resource", "iam_role", "payment_method", "payment_transaction", "saas_object", "any"];
export declare const DECISIONS: readonly ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"];
export declare const CONFIDENCES: readonly ["low", "medium", "high"];
export declare const ON_UNSUPPORTED: readonly ["hold_activation", "block", "review", "accept_risk"];
export declare const INVARIANTS: readonly ["fail_closed_transform", "fail_closed_no_rule", "fail_closed_uninspected"];
export declare const SUBJECT_KINDS: readonly ["any", "group", "user", "agent_class", "device", "workload"];
export declare const DEST_CLASS_NAMES: readonly string[];
export declare const SurfaceClauseSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        clause: "clause";
        definition: "definition";
        invariant: "invariant";
    }>;
    text: z.ZodString;
    confidence: z.ZodNumber;
    definitionGroup: z.ZodNullable<z.ZodString>;
    definitionLabel: z.ZodNullable<z.ZodString>;
    definitionMembers: z.ZodNullable<z.ZodArray<z.ZodString>>;
    invariant: z.ZodNullable<z.ZodEnum<{
        fail_closed_transform: "fail_closed_transform";
        fail_closed_no_rule: "fail_closed_no_rule";
        fail_closed_uninspected: "fail_closed_uninspected";
    }>>;
    subjectKind: z.ZodNullable<z.ZodEnum<{
        device: "device";
        any: "any";
        group: "group";
        user: "user";
        agent_class: "agent_class";
        workload: "workload";
    }>>;
    subjectRefs: z.ZodNullable<z.ZodArray<z.ZodString>>;
    action: z.ZodNullable<z.ZodString>;
    resourceKind: z.ZodNullable<z.ZodString>;
    resourceRefs: z.ZodNullable<z.ZodArray<z.ZodString>>;
    resourcePaths: z.ZodNullable<z.ZodArray<z.ZodString>>;
    resourceExcludePaths: z.ZodNullable<z.ZodArray<z.ZodString>>;
    destination: z.ZodNullable<z.ZodObject<{
        services: z.ZodNullable<z.ZodArray<z.ZodString>>;
        group: z.ZodNullable<z.ZodString>;
        class: z.ZodNullable<z.ZodEnum<{
            [x: string]: string;
        }>>;
        hosts: z.ZodNullable<z.ZodArray<z.ZodString>>;
        notInServices: z.ZodNullable<z.ZodArray<z.ZodString>>;
        notInGroup: z.ZodNullable<z.ZodString>;
        notInClass: z.ZodNullable<z.ZodEnum<{
            [x: string]: string;
        }>>;
        trust: z.ZodNullable<z.ZodEnum<{
            internal: "internal";
            external: "external";
        }>>;
    }, z.core.$strip>>;
    data: z.ZodNullable<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        minCount: z.ZodNullable<z.ZodNumber>;
        minConfidence: z.ZodNullable<z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
        }>>;
        scope: z.ZodNullable<z.ZodEnum<{
            any: "any";
            bulk: "bulk";
        }>>;
        fields: z.ZodNullable<z.ZodArray<z.ZodString>>;
        owner: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
    dataAll: z.ZodNullable<z.ZodBoolean>;
    environments: z.ZodNullable<z.ZodArray<z.ZodString>>;
    threshold: z.ZodNullable<z.ZodObject<{
        field: z.ZodNullable<z.ZodString>;
        op: z.ZodNullable<z.ZodString>;
        value: z.ZodNullable<z.ZodNumber>;
        unit: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    decision: z.ZodNullable<z.ZodEnum<{
        block: "block";
        review: "review";
        allow: "allow";
        constrain: "constrain";
    }>>;
    transforms: z.ZodNullable<z.ZodArray<z.ZodObject<{
        handler: z.ZodEnum<{
            REDACT: "REDACT";
            MASK: "MASK";
            REVERSIBLE_TOKENIZE: "REVERSIBLE_TOKENIZE";
            HASH: "HASH";
            DROP_FIELD: "DROP_FIELD";
            GENERALIZE: "GENERALIZE";
            DATE_SHIFT: "DATE_SHIFT";
            FORMAT_PRESERVING: "FORMAT_PRESERVING";
            LIMIT: "LIMIT";
            REWRITE: "REWRITE";
        }>;
        targets: z.ZodNullable<z.ZodArray<z.ZodString>>;
        params: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>>;
    approvers: z.ZodNullable<z.ZodArray<z.ZodString>>;
    exceptions: z.ZodNullable<z.ZodArray<z.ZodString>>;
    catchAll: z.ZodNullable<z.ZodBoolean>;
    onUnsupported: z.ZodNullable<z.ZodEnum<{
        hold_activation: "hold_activation";
        block: "block";
        review: "review";
        accept_risk: "accept_risk";
    }>>;
}, z.core.$strip>;
export type SurfaceClause = z.infer<typeof SurfaceClauseSchema>;
export declare const SurfaceIRSchema: z.ZodObject<{
    clauses: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            clause: "clause";
            definition: "definition";
            invariant: "invariant";
        }>;
        text: z.ZodString;
        confidence: z.ZodNumber;
        definitionGroup: z.ZodNullable<z.ZodString>;
        definitionLabel: z.ZodNullable<z.ZodString>;
        definitionMembers: z.ZodNullable<z.ZodArray<z.ZodString>>;
        invariant: z.ZodNullable<z.ZodEnum<{
            fail_closed_transform: "fail_closed_transform";
            fail_closed_no_rule: "fail_closed_no_rule";
            fail_closed_uninspected: "fail_closed_uninspected";
        }>>;
        subjectKind: z.ZodNullable<z.ZodEnum<{
            device: "device";
            any: "any";
            group: "group";
            user: "user";
            agent_class: "agent_class";
            workload: "workload";
        }>>;
        subjectRefs: z.ZodNullable<z.ZodArray<z.ZodString>>;
        action: z.ZodNullable<z.ZodString>;
        resourceKind: z.ZodNullable<z.ZodString>;
        resourceRefs: z.ZodNullable<z.ZodArray<z.ZodString>>;
        resourcePaths: z.ZodNullable<z.ZodArray<z.ZodString>>;
        resourceExcludePaths: z.ZodNullable<z.ZodArray<z.ZodString>>;
        destination: z.ZodNullable<z.ZodObject<{
            services: z.ZodNullable<z.ZodArray<z.ZodString>>;
            group: z.ZodNullable<z.ZodString>;
            class: z.ZodNullable<z.ZodEnum<{
                [x: string]: string;
            }>>;
            hosts: z.ZodNullable<z.ZodArray<z.ZodString>>;
            notInServices: z.ZodNullable<z.ZodArray<z.ZodString>>;
            notInGroup: z.ZodNullable<z.ZodString>;
            notInClass: z.ZodNullable<z.ZodEnum<{
                [x: string]: string;
            }>>;
            trust: z.ZodNullable<z.ZodEnum<{
                internal: "internal";
                external: "external";
            }>>;
        }, z.core.$strip>>;
        data: z.ZodNullable<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            minCount: z.ZodNullable<z.ZodNumber>;
            minConfidence: z.ZodNullable<z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>>;
            scope: z.ZodNullable<z.ZodEnum<{
                any: "any";
                bulk: "bulk";
            }>>;
            fields: z.ZodNullable<z.ZodArray<z.ZodString>>;
            owner: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
        dataAll: z.ZodNullable<z.ZodBoolean>;
        environments: z.ZodNullable<z.ZodArray<z.ZodString>>;
        threshold: z.ZodNullable<z.ZodObject<{
            field: z.ZodNullable<z.ZodString>;
            op: z.ZodNullable<z.ZodString>;
            value: z.ZodNullable<z.ZodNumber>;
            unit: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>;
        decision: z.ZodNullable<z.ZodEnum<{
            block: "block";
            review: "review";
            allow: "allow";
            constrain: "constrain";
        }>>;
        transforms: z.ZodNullable<z.ZodArray<z.ZodObject<{
            handler: z.ZodEnum<{
                REDACT: "REDACT";
                MASK: "MASK";
                REVERSIBLE_TOKENIZE: "REVERSIBLE_TOKENIZE";
                HASH: "HASH";
                DROP_FIELD: "DROP_FIELD";
                GENERALIZE: "GENERALIZE";
                DATE_SHIFT: "DATE_SHIFT";
                FORMAT_PRESERVING: "FORMAT_PRESERVING";
                LIMIT: "LIMIT";
                REWRITE: "REWRITE";
            }>;
            targets: z.ZodNullable<z.ZodArray<z.ZodString>>;
            params: z.ZodNullable<z.ZodString>;
        }, z.core.$strip>>>;
        approvers: z.ZodNullable<z.ZodArray<z.ZodString>>;
        exceptions: z.ZodNullable<z.ZodArray<z.ZodString>>;
        catchAll: z.ZodNullable<z.ZodBoolean>;
        onUnsupported: z.ZodNullable<z.ZodEnum<{
            hold_activation: "hold_activation";
            block: "block";
            review: "review";
            accept_risk: "accept_risk";
        }>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SurfaceIR = z.infer<typeof SurfaceIRSchema>;
export declare const PredicateSchema: z.ZodObject<{
    field: z.ZodString;
    op: z.ZodString;
    value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
}, z.core.$strip>;
export type Predicate = z.infer<typeof PredicateSchema>;
export declare const DataRefSchema: z.ZodObject<{
    type: z.ZodString;
    resolution: z.ZodEnum<{
        id: "id";
        alias: "alias";
        phrase: "phrase";
        candidate: "candidate";
    }>;
    sourcePhrase: z.ZodString;
    match: z.ZodObject<{
        minCount: z.ZodNumber;
        minConfidence: z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
        }>;
        scope: z.ZodEnum<{
            any: "any";
            bulk: "bulk";
        }>;
        origin: z.ZodEnum<{
            clause: "clause";
            registry: "registry";
            inherited: "inherited";
        }>;
    }, z.core.$strip>;
    fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    owner: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DataRef = z.infer<typeof DataRefSchema>;
export declare const DestRefSchema: z.ZodObject<{
    classes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        [x: string]: string;
    }>>>;
    services: z.ZodOptional<z.ZodArray<z.ZodString>>;
    groups: z.ZodOptional<z.ZodArray<z.ZodString>>;
    hosts: z.ZodOptional<z.ZodArray<z.ZodString>>;
    notIn: z.ZodOptional<z.ZodObject<{
        classes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            [x: string]: string;
        }>>>;
        services: z.ZodOptional<z.ZodArray<z.ZodString>>;
        groups: z.ZodOptional<z.ZodArray<z.ZodString>>;
        hosts: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    trust: z.ZodOptional<z.ZodEnum<{
        internal: "internal";
        external: "external";
    }>>;
    unresolved: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type DestRef = z.infer<typeof DestRefSchema>;
export declare const TransformRefSchema: z.ZodObject<{
    handler: z.ZodEnum<{
        REDACT: "REDACT";
        MASK: "MASK";
        REVERSIBLE_TOKENIZE: "REVERSIBLE_TOKENIZE";
        HASH: "HASH";
        DROP_FIELD: "DROP_FIELD";
        GENERALIZE: "GENERALIZE";
        DATE_SHIFT: "DATE_SHIFT";
        FORMAT_PRESERVING: "FORMAT_PRESERVING";
        LIMIT: "LIMIT";
        REWRITE: "REWRITE";
    }>;
    targets: z.ZodUnion<readonly [z.ZodLiteral<"matched">, z.ZodObject<{
        types: z.ZodOptional<z.ZodArray<z.ZodString>>;
        fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>]>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type TransformRef = z.infer<typeof TransformRefSchema>;
export declare const ClauseIRSchema: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodObject<{
        text: z.ZodString;
        span: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
    }, z.core.$strip>;
    confidence: z.ZodNumber;
    subject: z.ZodObject<{
        kind: z.ZodEnum<{
            device: "device";
            any: "any";
            group: "group";
            user: "user";
            agent_class: "agent_class";
            workload: "workload";
        }>;
        refs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    action: z.ZodEnum<{
        push: "push";
        read: "read";
        write: "write";
        delete: "delete";
        execute: "execute";
        query: "query";
        merge: "merge";
        invoke: "invoke";
        disclose: "disclose";
        transact: "transact";
        configure: "configure";
        connect: "connect";
        list: "list";
    }>;
    resource: z.ZodObject<{
        type: z.ZodEnum<{
            table: "table";
            any: "any";
            file: "file";
            folder: "folder";
            repo: "repo";
            branch: "branch";
            database: "database";
            dataset: "dataset";
            schema: "schema";
            column: "column";
            db_statement: "db_statement";
            endpoint: "endpoint";
            api: "api";
            mcp_tool: "mcp_tool";
            account: "account";
            cloud_resource: "cloud_resource";
            iam_role: "iam_role";
            payment_method: "payment_method";
            payment_transaction: "payment_transaction";
            saas_object: "saas_object";
        }>;
        refs: z.ZodOptional<z.ZodArray<z.ZodString>>;
        paths: z.ZodOptional<z.ZodObject<{
            include: z.ZodOptional<z.ZodArray<z.ZodString>>;
            exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    data: z.ZodOptional<z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        resolution: z.ZodEnum<{
            id: "id";
            alias: "alias";
            phrase: "phrase";
            candidate: "candidate";
        }>;
        sourcePhrase: z.ZodString;
        match: z.ZodObject<{
            minCount: z.ZodNumber;
            minConfidence: z.ZodEnum<{
                low: "low";
                medium: "medium";
                high: "high";
            }>;
            scope: z.ZodEnum<{
                any: "any";
                bulk: "bulk";
            }>;
            origin: z.ZodEnum<{
                clause: "clause";
                registry: "registry";
                inherited: "inherited";
            }>;
        }, z.core.$strip>;
        fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
        owner: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    dataAll: z.ZodOptional<z.ZodBoolean>;
    destination: z.ZodOptional<z.ZodObject<{
        classes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            [x: string]: string;
        }>>>;
        services: z.ZodOptional<z.ZodArray<z.ZodString>>;
        groups: z.ZodOptional<z.ZodArray<z.ZodString>>;
        hosts: z.ZodOptional<z.ZodArray<z.ZodString>>;
        notIn: z.ZodOptional<z.ZodObject<{
            classes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                [x: string]: string;
            }>>>;
            services: z.ZodOptional<z.ZodArray<z.ZodString>>;
            groups: z.ZodOptional<z.ZodArray<z.ZodString>>;
            hosts: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        trust: z.ZodOptional<z.ZodEnum<{
            internal: "internal";
            external: "external";
        }>>;
        unresolved: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    scope: z.ZodOptional<z.ZodObject<{
        environments: z.ZodOptional<z.ZodArray<z.ZodString>>;
        instances: z.ZodOptional<z.ZodArray<z.ZodString>>;
        owner: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    conditions: z.ZodOptional<z.ZodObject<{
        requires: z.ZodOptional<z.ZodArray<z.ZodObject<{
            field: z.ZodString;
            op: z.ZodString;
            value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
        }, z.core.$strip>>>;
        count: z.ZodOptional<z.ZodObject<{
            per: z.ZodEnum<{
                request: "request";
                session: "session";
                hour: "hour";
                day: "day";
            }>;
            max: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    decision: z.ZodEnum<{
        ALLOW: "ALLOW";
        CONSTRAIN: "CONSTRAIN";
        REVIEW: "REVIEW";
        BLOCK: "BLOCK";
    }>;
    transforms: z.ZodOptional<z.ZodArray<z.ZodObject<{
        handler: z.ZodEnum<{
            REDACT: "REDACT";
            MASK: "MASK";
            REVERSIBLE_TOKENIZE: "REVERSIBLE_TOKENIZE";
            HASH: "HASH";
            DROP_FIELD: "DROP_FIELD";
            GENERALIZE: "GENERALIZE";
            DATE_SHIFT: "DATE_SHIFT";
            FORMAT_PRESERVING: "FORMAT_PRESERVING";
            LIMIT: "LIMIT";
            REWRITE: "REWRITE";
        }>;
        targets: z.ZodUnion<readonly [z.ZodLiteral<"matched">, z.ZodObject<{
            types: z.ZodOptional<z.ZodArray<z.ZodString>>;
            fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>]>;
        params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>>;
    review: z.ZodOptional<z.ZodObject<{
        approvers: z.ZodArray<z.ZodString>;
        quorum: z.ZodOptional<z.ZodNumber>;
        permit: z.ZodOptional<z.ZodObject<{
            ttlSeconds: z.ZodNumber;
            singleUse: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        failClosed: z.ZodLiteral<true>;
    }, z.core.$strip>>;
    onUnsupported: z.ZodEnum<{
        hold_activation: "hold_activation";
        block: "block";
        review: "review";
        accept_risk: "accept_risk";
    }>;
    acceptRisk: z.ZodOptional<z.ZodObject<{
        by: z.ZodString;
        reason: z.ZodString;
        at: z.ZodString;
    }, z.core.$strip>>;
    catchAll: z.ZodOptional<z.ZodBoolean>;
    exceptions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    priority: z.ZodNumber;
}, z.core.$strip>;
export type ClauseIR = z.infer<typeof ClauseIRSchema>;
export declare const PolicyIRSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    contract: z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        tenant: z.ZodString;
        sourceText: z.ZodString;
        sourceSha256: z.ZodString;
        compiledAt: z.ZodString;
        compiler: z.ZodObject<{
            mode: z.ZodEnum<{
                llm: "llm";
                fallback: "fallback";
                authored: "authored";
            }>;
            model: z.ZodOptional<z.ZodString>;
            schemaVersion: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    pins: z.ZodObject<{
        dataTypes: z.ZodString;
        destinations: z.ZodString;
        detectors: z.ZodString;
        transforms: z.ZodString;
        extractors: z.ZodString;
    }, z.core.$strip>;
    definitions: z.ZodObject<{
        destinationGroups: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodString;
            members: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
        dataGroups: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodString;
            types: z.ZodArray<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    invariants: z.ZodArray<z.ZodEnum<{
        fail_closed_transform: "fail_closed_transform";
        fail_closed_no_rule: "fail_closed_no_rule";
        fail_closed_uninspected: "fail_closed_uninspected";
    }>>;
    clauses: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        source: z.ZodObject<{
            text: z.ZodString;
            span: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
        }, z.core.$strip>;
        confidence: z.ZodNumber;
        subject: z.ZodObject<{
            kind: z.ZodEnum<{
                device: "device";
                any: "any";
                group: "group";
                user: "user";
                agent_class: "agent_class";
                workload: "workload";
            }>;
            refs: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        action: z.ZodEnum<{
            push: "push";
            read: "read";
            write: "write";
            delete: "delete";
            execute: "execute";
            query: "query";
            merge: "merge";
            invoke: "invoke";
            disclose: "disclose";
            transact: "transact";
            configure: "configure";
            connect: "connect";
            list: "list";
        }>;
        resource: z.ZodObject<{
            type: z.ZodEnum<{
                table: "table";
                any: "any";
                file: "file";
                folder: "folder";
                repo: "repo";
                branch: "branch";
                database: "database";
                dataset: "dataset";
                schema: "schema";
                column: "column";
                db_statement: "db_statement";
                endpoint: "endpoint";
                api: "api";
                mcp_tool: "mcp_tool";
                account: "account";
                cloud_resource: "cloud_resource";
                iam_role: "iam_role";
                payment_method: "payment_method";
                payment_transaction: "payment_transaction";
                saas_object: "saas_object";
            }>;
            refs: z.ZodOptional<z.ZodArray<z.ZodString>>;
            paths: z.ZodOptional<z.ZodObject<{
                include: z.ZodOptional<z.ZodArray<z.ZodString>>;
                exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
        data: z.ZodOptional<z.ZodArray<z.ZodObject<{
            type: z.ZodString;
            resolution: z.ZodEnum<{
                id: "id";
                alias: "alias";
                phrase: "phrase";
                candidate: "candidate";
            }>;
            sourcePhrase: z.ZodString;
            match: z.ZodObject<{
                minCount: z.ZodNumber;
                minConfidence: z.ZodEnum<{
                    low: "low";
                    medium: "medium";
                    high: "high";
                }>;
                scope: z.ZodEnum<{
                    any: "any";
                    bulk: "bulk";
                }>;
                origin: z.ZodEnum<{
                    clause: "clause";
                    registry: "registry";
                    inherited: "inherited";
                }>;
            }, z.core.$strip>;
            fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            owner: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        dataAll: z.ZodOptional<z.ZodBoolean>;
        destination: z.ZodOptional<z.ZodObject<{
            classes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                [x: string]: string;
            }>>>;
            services: z.ZodOptional<z.ZodArray<z.ZodString>>;
            groups: z.ZodOptional<z.ZodArray<z.ZodString>>;
            hosts: z.ZodOptional<z.ZodArray<z.ZodString>>;
            notIn: z.ZodOptional<z.ZodObject<{
                classes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                    [x: string]: string;
                }>>>;
                services: z.ZodOptional<z.ZodArray<z.ZodString>>;
                groups: z.ZodOptional<z.ZodArray<z.ZodString>>;
                hosts: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>>;
            trust: z.ZodOptional<z.ZodEnum<{
                internal: "internal";
                external: "external";
            }>>;
            unresolved: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        scope: z.ZodOptional<z.ZodObject<{
            environments: z.ZodOptional<z.ZodArray<z.ZodString>>;
            instances: z.ZodOptional<z.ZodArray<z.ZodString>>;
            owner: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        conditions: z.ZodOptional<z.ZodObject<{
            requires: z.ZodOptional<z.ZodArray<z.ZodObject<{
                field: z.ZodString;
                op: z.ZodString;
                value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
            }, z.core.$strip>>>;
            count: z.ZodOptional<z.ZodObject<{
                per: z.ZodEnum<{
                    request: "request";
                    session: "session";
                    hour: "hour";
                    day: "day";
                }>;
                max: z.ZodNumber;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        decision: z.ZodEnum<{
            ALLOW: "ALLOW";
            CONSTRAIN: "CONSTRAIN";
            REVIEW: "REVIEW";
            BLOCK: "BLOCK";
        }>;
        transforms: z.ZodOptional<z.ZodArray<z.ZodObject<{
            handler: z.ZodEnum<{
                REDACT: "REDACT";
                MASK: "MASK";
                REVERSIBLE_TOKENIZE: "REVERSIBLE_TOKENIZE";
                HASH: "HASH";
                DROP_FIELD: "DROP_FIELD";
                GENERALIZE: "GENERALIZE";
                DATE_SHIFT: "DATE_SHIFT";
                FORMAT_PRESERVING: "FORMAT_PRESERVING";
                LIMIT: "LIMIT";
                REWRITE: "REWRITE";
            }>;
            targets: z.ZodUnion<readonly [z.ZodLiteral<"matched">, z.ZodObject<{
                types: z.ZodOptional<z.ZodArray<z.ZodString>>;
                fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>]>;
            params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>>>;
        review: z.ZodOptional<z.ZodObject<{
            approvers: z.ZodArray<z.ZodString>;
            quorum: z.ZodOptional<z.ZodNumber>;
            permit: z.ZodOptional<z.ZodObject<{
                ttlSeconds: z.ZodNumber;
                singleUse: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>;
            failClosed: z.ZodLiteral<true>;
        }, z.core.$strip>>;
        onUnsupported: z.ZodEnum<{
            hold_activation: "hold_activation";
            block: "block";
            review: "review";
            accept_risk: "accept_risk";
        }>;
        acceptRisk: z.ZodOptional<z.ZodObject<{
            by: z.ZodString;
            reason: z.ZodString;
            at: z.ZodString;
        }, z.core.$strip>>;
        catchAll: z.ZodOptional<z.ZodBoolean>;
        exceptions: z.ZodOptional<z.ZodArray<z.ZodString>>;
        priority: z.ZodNumber;
    }, z.core.$strip>>;
    rejected: z.ZodArray<z.ZodObject<{
        text: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strip>>;
    warnings: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type PolicyIR = z.infer<typeof PolicyIRSchema>;
export declare const IR_SCHEMA_VERSION = "1.0.0";
/**
 * Structured Outputs (strict) requires `additionalProperties:false` on every
 * object and every key in `required`. Zod's JSON Schema export already emits
 * the shape; this walks it to enforce both rules and strips features the API
 * subset does not accept.
 */
export declare function extractionJsonSchema(): Record<string, unknown>;
export declare function severityTier(d: (typeof DECISIONS)[number]): number;
/** How many independent conditions pin a clause — its specificity within a tier. */
export declare function specificity(c: Pick<ClauseIR, "destination" | "data" | "resource" | "scope" | "conditions" | "subject">): number;
export declare function derivePriority(c: Pick<ClauseIR, "decision" | "destination" | "data" | "resource" | "scope" | "conditions" | "subject" | "catchAll">): number;
