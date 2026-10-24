import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { prepareRelations, normalizeRelations, emptyRelations } from './relations.js';
import { randomUUID } from 'node:crypto';
import sanitize from 'sanitize-html';
import { decodeHTML } from 'entities';
import { kinds, cleanContent } from '../store.js';
import { suggestionSchema, validateSchema } from './schema.js';
import { OpenAIProvider, AiError, providerSettings } from './provider.js';
import { DeepSeekProvider } from './deepseek.js';
import { prepareCollectionInput, normalizeCollection, collectionEmpty } from './collection.js';
import { createCredentials } from './credentials.js';
import { prepareKnowledgeInput, normalizeIntegration, integrationEmpty } from './knowledge.js';
import { prepareAssistant, normalizeAssistant, qaEmpty, structureEmpty } from './assistant.js';

const empty = () => ({
  status: 'insufficient',
  title: '',
  summary: '',
  reason: '信息不足：请补充至少 24 个字的具体简介或正文，AI 不会根据网址推测内容。',
  domains: [],
  tags: [],
  collections: [],
  newTags: [],
  points: [],
  sections: [],
});
const plain = (html) =>
  decodeHTML(
    sanitize(html.replace(/<\/(p|h2|h3|li|blockquote)>/g, '$&\n'), {
      allowedTags: [],
      allowedAttributes: {},
    }),
  ).trim();
export function createAiService(
  dir,
  getDb,
  { env = process.env, transport, credentialDir, protection } = {},
) {
  const credentials = createCredentials(dir, { env, credentialDir, protection });
  let config,
    configError,
    active = false,
    activeController;
  function refresh(withKey = false) {
    configError = undefined;
    try {
      config = credentials.config(withKey);
    } catch (e) {
      configError = e instanceof AiError ? e : new AiError('config');
    }
  }
  refresh();
  const file = path.join(dir, 'ai-usage.json');
  function ledger() {
    if (!existsSync(file)) return { version: 1, records: [] };
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > 2000)
        throw Error();
      if (
        value.records.some(
          (r) =>
            !r ||
            typeof r.id !== 'string' ||
            !Number.isFinite(Date.parse(r.at)) ||
            !Object.hasOwn(providerSettings, r.provider) ||
            !providerSettings[r.provider].models.includes(r.model) ||
            ![
              'bookmark',
              'note',
              'collection',
              'integration',
              'connection',
              'assistant_qa',
              'assistant_structure',
              'relations',
            ].includes(r.mode) ||
            (r.outcome !== undefined &&
              !['ready', 'insufficient', 'connection', null].includes(r.outcome)) ||
            ![
              'pending',
              'success',
              'timeout',
              'cancelled',
              'network',
              'upstream',
              'refusal',
              'invalid_output',
              'invalid_key',
              'balance',
              'model',
              'upstream_rate',
              'secure_storage',
              'config',
            ].includes(r.status) ||
            (r.usage &&
              ['inputTokens', 'outputTokens', 'cachedTokens', 'estimatedUSD'].some(
                (k) =>
                  typeof r.usage[k] !== 'number' || !Number.isFinite(r.usage[k]) || r.usage[k] < 0,
              )),
        )
      )
        throw Error();
      return value;
    } catch {
      throw new AiError('usage_storage');
    }
  }
  function record(value) {
    const current = ledger();
    current.records = [...current.records.filter((r) => r.id !== value.id), value].slice(-2000);
    try {
      writeFileSync(file + '.tmp', JSON.stringify(current));
      renameSync(file + '.tmp', file);
    } catch {
      throw new AiError('usage_storage');
    }
  }
  function status() {
    refresh();
    const settings = credentials.publicState();
    let records = [],
      usageError = false;
    try {
      records = ledger().records;
    } catch {
      usageError = true;
    }
    return {
      configured:
        !!settings.keys[config?.provider] && !settings.storageError && !configError && !usageError,
      message:
        settings.storageError ||
        configError?.message ||
        (usageError
          ? new AiError('usage_storage').message
          : settings.keys[config?.provider]
            ? ''
            : new AiError('not_configured').message),
      provider: config?.provider || 'openai',
      model: config?.model || '',
      endpoint: config?.endpoint || '',
      prices: config?.prices || { input: 0.4, cached: 0.1, output: 1.6 },
      settings,
      providers: Object.fromEntries(
        Object.entries(providerSettings).map(([p, s]) => [
          p,
          { models: s.models, endpoint: s.endpoint },
        ]),
      ),
      lastSuccess:
        records
          .filter(
            (r) =>
              r.status === 'success' &&
              r.outcome === 'ready' &&
              r.mode !== 'connection' &&
              r.provider === config?.provider &&
              r.model === config?.model,
          )
          .at(-1)?.at || null,
      limits: config
        ? {
            timeoutMs: config.timeoutMs,
            maxInputChars: config.maxInputChars,
            maxOutputTokens: config.maxOutputTokens,
            maxCallsPerHour: config.maxCallsPerHour,
            maxTaxonomyPerKind: config.maxTaxonomyPerKind,
            maxBatchSize: 1,
          }
        : null,
      usage: {
        recordedRequests: records.length,
        inputTokens: records.reduce((s, r) => s + (r.usage?.inputTokens || 0), 0),
        outputTokens: records.reduce((s, r) => s + (r.usage?.outputTokens || 0), 0),
        estimatedUSD: records.reduce((s, r) => s + (r.usage?.estimatedUSD || 0), 0),
        unknownUsage: records.filter((r) => !r.usage).length,
      },
    };
  }
  async function suggest(input, signal = new AbortController().signal) {
    const relation = input?.mode === 'relations';
    const connection = input?.mode === 'connection';
    const integration = input?.mode === 'integration';
    const assistant = ['assistant_qa', 'assistant_structure'].includes(input?.mode);
    const collection = relation
      ? prepareRelations(getDb(), input)
      : assistant
        ? prepareAssistant(getDb(), input)
        : integration
          ? prepareKnowledgeInput(getDb(), input)
          : input?.mode === 'collection'
            ? prepareCollectionInput(getDb(), input)
            : null;
    if (collection?.insufficient)
      return {
        suggestion: relation
          ? emptyRelations()
          : assistant
            ? input.mode === 'assistant_qa'
              ? qaEmpty()
              : structureEmpty()
            : integration
              ? integrationEmpty()
              : collectionEmpty(),
        usage: null,
      };
    if (!connection && !collection && (!['bookmark', 'note'].includes(input?.mode) || !input.form))
      throw new AiError('input');
    const f = input.form;
    let body = '';
    if (!collection && !connection) {
      if (
        ['title', 'description', 'content'].some((k) => typeof f[k] !== 'string') ||
        f.content.length > 1_000_000 ||
        f.title.length > 200 ||
        f.description.length > 2000
      )
        throw new AiError('input');
      body = plain(cleanContent(f.content));
      const evidence = input.mode === 'note' ? body : f.description + body;
      if (evidence.replace(/https?:\/\/[^\s<>]+/gi, '').replace(/\s/g, '').length < 24)
        return { suggestion: empty(), usage: null };
      if (f.title.length + f.description.length + body.length > 12000) throw new AiError('input');
    }
    refresh();
    if (configError) throw configError;
    const savedState = credentials.publicState();
    if (savedState.storageError) throw new AiError('secure_storage');
    if (!savedState.keys[config.provider]) throw new AiError('not_configured');
    if (active) throw new AiError('busy');
    const records = ledger().records;
    if (
      records.filter((r) => Date.parse(r.at) > Date.now() - 3600000).length >=
      config.maxCallsPerHour
    )
      throw new AiError('rate');
    const db = getDb();
    const taxonomy =
      collection || connection
        ? null
        : Object.fromEntries(
            kinds.map((k) => {
              const all = db.prepare(`SELECT id,name FROM ${k} ORDER BY name`).all();
              const selected = Array.isArray(f[k])
                ? f[k].filter((id) => typeof id === 'string').slice(0, 100)
                : [];
              return [
                k,
                [
                  ...all.filter((t) => selected.includes(t.id)),
                  ...all.filter((t) => !selected.includes(t.id)),
                ].slice(0, 40),
              ];
            }),
          );
    const schema = connection
      ? {
          type: 'object',
          properties: { answer: { type: 'string', enum: ['ok'] } },
          required: ['answer'],
          additionalProperties: false,
        }
      : collection
        ? collection.schema
        : suggestionSchema(taxonomy);
    const controller = new AbortController();
    const combined = AbortSignal.any([controller.signal, signal]);
    const row = {
      id: randomUUID(),
      at: new Date().toISOString(),
      provider: config.provider,
      model: config.model,
      mode: input.mode,
      status: 'pending',
      usage: null,
    };
    record(row);
    active = true;
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(new AiError('timeout')), config.timeoutMs);
    try {
      const Provider = config.provider === 'deepseek' ? DeepSeekProvider : OpenAIProvider;
      const requestConfig = credentials.config(true);
      const result = await new Provider(requestConfig, transport).generate({
        input: connection
          ? { mode: 'connection' }
          : collection
            ? collection.payload
            : {
                mode: input.mode,
                title: f.title,
                description: f.description,
                note: body,
                taxonomy,
              },
        schema,
        signal: combined,
      });
      row.usage = result.usage;
      // Even a malformed upstream success must never echo the credential into review/data.
      if (
        requestConfig.key &&
        JSON.stringify(result.value).includes(JSON.stringify(requestConfig.key).slice(1, -1))
      )
        throw new AiError('invalid_output');
      try {
        validateSchema(result.value, schema);
      } catch {
        throw new AiError('invalid_output');
      }
      const suggestion = result.value;
      if (collection)
        Object.assign(
          suggestion,
          relation
            ? normalizeRelations(suggestion, collection)
            : assistant
              ? normalizeAssistant(suggestion, collection)
              : integration
                ? normalizeIntegration(suggestion, collection)
                : normalizeCollection(suggestion, collection),
        );
      else if (!connection) {
        for (const k of kinds)
          if (suggestion[k].some((id) => !taxonomy[k].some((t) => t.id === id)))
            throw new AiError('invalid_output');
        if (suggestion.newTags.some((t) => !t.trim())) throw new AiError('invalid_output');
        if (suggestion.status === 'ready' && input.mode === 'note' && !suggestion.sections.length)
          throw new AiError('invalid_output');
        if (suggestion.status === 'insufficient')
          Object.assign(suggestion, empty(), { reason: suggestion.reason || empty().reason });
        for (const k of kinds) suggestion[k] = [...new Set(suggestion[k])];
        suggestion.newTags = [...new Set(suggestion.newTags.map((t) => t.trim()))].filter(
          (name) => !taxonomy.tags.some((t) => t.name === name),
        );
      }
      row.status = 'success';
      row.outcome = connection ? 'connection' : suggestion.status;
      let usageWarning = '';
      try {
        record(row);
      } catch {
        usageWarning = '用量记录写入失败，建议已生成；请检查本地磁盘。';
      }
      return {
        suggestion,
        usage: row.usage,
        usageWarning,
        ...(collection
          ? {
              sources: collection.sources,
              revision: collection.revision,
              ...(integration ? { snapshots: collection.snapshots } : {}),
            }
          : {}),
      };
    } catch (e) {
      const error = combined.aborted
        ? combined.reason instanceof AiError
          ? combined.reason
          : new AiError('cancelled')
        : e instanceof AiError
          ? e
          : new AiError('invalid_output');
      row.status = error.code || 'upstream';
      row.usage = error.usage || row.usage;
      try {
        record(row);
      } catch {
        /* AI-only failure; never log credentials or provider data. */
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      active = false;
      activeController = undefined;
      if (config) config.key = '';
    }
  }
  async function testConnection(signal) {
    const revision = credentials.publicState().revision;
    try {
      await suggest({ mode: 'connection' }, signal);
      credentials.testResult(revision, 'success');
      return status();
    } catch (e) {
      try {
        credentials.testResult(revision, e.code || 'upstream');
      } catch {}
      throw e;
    }
  }
  return {
    status,
    suggest,
    testConnection,
    update: (input) => {
      if (active) throw new AiError('busy');
      credentials.update(input);
      return status();
    },
    cancel: () => activeController?.abort(new AiError('cancelled')),
  };
}
