"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDiagram = void 0;
const axios_1 = __importDefault(require("axios"));
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const extractJsonBlock = (input) => {
    const fenceMatch = input.match(/```json\s*([\s\S]*?)\s*```/i) || input.match(/```\s*([\s\S]*?)\s*```/i);
    if (fenceMatch?.[1]) {
        return fenceMatch[1].trim();
    }
    const firstBrace = input.indexOf('{');
    if (firstBrace === -1)
        return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = firstBrace; i < input.length; i++) {
        const ch = input[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (ch === '\\') {
                escaped = true;
            }
            else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{')
            depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) {
                return input.slice(firstBrace, i + 1).trim();
            }
        }
    }
    return null;
};
const getErPrompt = (prompt) => `You are an expert database schema designer.
Generate JSON with keys nodes and edges.
Each node must represent a table with: id, type="table", position{x,y}, data{name, fields[]}.
Each field needs: name, type, isPrimaryKey, isIdentity, isForeignKey, isNullable.
Keep the schema concise (max 8 tables).
Edges define relationships with id, source, target, type="animated", animated=true.
Return ONLY JSON.
User request: ${prompt}`;
const getSystemPrompt = (prompt) => `You are an expert system design architect.
Generate JSON with keys nodes and edges.
Each node must have: id, type="table", position{x,y}, data{name, kind="system", icon, category, description, fields:[]}.
Allowed icon values: react,angular,vuedotjs,reactnative,flutter,kotlin,swift,android,apple,nodedotjs,express,springboot,postgresql,mysql,mongodb,redis,kafka,rabbitmq,nginx,cloudflare,fastly,akamai,amazonaws,googlecloud,microsoftazure,vercel,netlify,docker,kubernetes,graphql,firebase,supabase,unity,unrealengine,xbox,playstation,nintendo,steam.
For web apps, mobile apps, CDN, game clients, and backend resources, prefer recognizable provider/framework icons that match the component.
Keep output concise: max 10 nodes and short descriptions (<= 10 words each).
Each edge must have id, source, target, type="animated", animated=true and optional label.
Return ONLY JSON.
User request: ${prompt}`;
const makeEdge = (source, target, label) => ({
    id: `${source}-${target}`,
    source,
    target,
    type: 'animated',
    animated: true,
    label,
});
const fallbackSchema = (prompt, type) => {
    const lower = prompt.toLowerCase();
    if (type === 'system') {
        const nodes = [
            {
                id: 'web-app',
                type: 'table',
                position: { x: 60, y: 120 },
                data: { name: 'Web App', kind: 'system', icon: lower.includes('angular') ? 'angular' : 'react', category: 'Frontend', description: 'Browser client', fields: [] },
            },
            {
                id: 'mobile-app',
                type: 'table',
                position: { x: 60, y: 300 },
                data: { name: 'Mobile App', kind: 'system', icon: lower.includes('kotlin') ? 'kotlin' : lower.includes('android') ? 'android' : 'reactnative', category: 'Mobile', description: 'Phone client', fields: [] },
            },
            {
                id: 'cdn',
                type: 'table',
                position: { x: 340, y: 120 },
                data: { name: 'CDN', kind: 'system', icon: lower.includes('akamai') ? 'akamai' : lower.includes('fastly') ? 'fastly' : 'cloudflare', category: 'Edge', description: 'Static delivery', fields: [] },
            },
            {
                id: 'api',
                type: 'table',
                position: { x: 620, y: 180 },
                data: { name: 'API Service', kind: 'system', icon: 'nodedotjs', category: 'Backend', description: 'Core APIs', fields: [] },
            },
            {
                id: 'db',
                type: 'table',
                position: { x: 900, y: 180 },
                data: { name: lower.includes('mongo') ? 'MongoDB' : 'PostgreSQL', kind: 'system', icon: lower.includes('mongo') ? 'mongodb' : 'postgresql', category: 'Data', description: 'Primary database', fields: [] },
            },
        ];
        const edges = [
            makeEdge('web-app', 'cdn', 'HTTPS'),
            makeEdge('mobile-app', 'cdn', 'HTTPS'),
            makeEdge('cdn', 'api', 'Route'),
            makeEdge('api', 'db', 'SQL/Query'),
        ];
        return { nodes, edges };
    }
    const nodes = [
        {
            id: 'users',
            type: 'table',
            position: { x: 100, y: 100 },
            data: { name: 'users', fields: [{ name: 'id', type: 'INT', isPrimaryKey: true, isIdentity: true, isForeignKey: false, isNullable: false }, { name: 'email', type: 'VARCHAR(255)', isPrimaryKey: false, isIdentity: false, isForeignKey: false, isNullable: false }] },
        },
        {
            id: 'orders',
            type: 'table',
            position: { x: 420, y: 100 },
            data: { name: 'orders', fields: [{ name: 'id', type: 'INT', isPrimaryKey: true, isIdentity: true, isForeignKey: false, isNullable: false }, { name: 'user_id', type: 'INT', isPrimaryKey: false, isIdentity: false, isForeignKey: true, isNullable: false }] },
        },
        {
            id: 'order_items',
            type: 'table',
            position: { x: 740, y: 100 },
            data: { name: 'order_items', fields: [{ name: 'id', type: 'INT', isPrimaryKey: true, isIdentity: true, isForeignKey: false, isNullable: false }, { name: 'order_id', type: 'INT', isPrimaryKey: false, isIdentity: false, isForeignKey: true, isNullable: false }] },
        },
    ];
    const edges = [makeEdge('users', 'orders'), makeEdge('orders', 'order_items')];
    return { nodes, edges };
};
const generateDiagram = async (req, res) => {
    const { prompt, diagramType, context } = req.body;
    if (!prompt || !prompt.trim()) {
        return res.status(400).json({ message: 'Prompt is required.' });
    }
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const resolvedType = diagramType === 'system' ? 'system' : 'er';
    const basePrompt = resolvedType === 'system' ? getSystemPrompt(prompt) : getErPrompt(prompt);
    const safeContext = typeof context === 'string' ? context.trim().slice(-12000) : '';
    const promptWithContext = safeContext
        ? `${basePrompt}

Additional context from existing chat/schema state:
${safeContext}

Important: treat this as an EDIT request on the current diagram and preserve existing structure unless change is requested.`
        : basePrompt;
    if (!geminiApiKey) {
        return res.status(200).json({
            source: 'fallback',
            reason: 'GEMINI_KEY_MISSING',
            schema: fallbackSchema(prompt, resolvedType),
        });
    }
    const callGemini = async (textPrompt) => {
        return axios_1.default.post(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
            contents: [{ parts: [{ text: textPrompt }] }],
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 10000,
                responseMimeType: 'application/json',
            },
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
        });
    };
    const tryParseSchema = (rawText) => {
        const candidate = extractJsonBlock(rawText) || rawText.trim();
        return JSON.parse(candidate);
    };
    try {
        let response = await callGemini(promptWithContext);
        let generatedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!generatedText || typeof generatedText !== 'string') {
            generatedText = '';
        }
        let schema;
        try {
            schema = tryParseSchema(generatedText);
        }
        catch {
            const retryPrompt = `${promptWithContext}\n` +
                'CRITICAL: Return only a strict JSON object. No markdown, no prose, no explanations.';
            response = await callGemini(retryPrompt);
            generatedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            try {
                schema = tryParseSchema(generatedText);
            }
            catch {
                const repairPrompt = 'Repair and complete this malformed JSON to a valid JSON object. ' +
                    'Return only JSON with keys "nodes" and "edges". ' +
                    'If details are missing due to truncation, infer minimally and preserve existing structure.\n\n' +
                    generatedText;
                response = await callGemini(repairPrompt);
                const repairedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                try {
                    schema = tryParseSchema(repairedText);
                }
                catch {
                    return res.status(200).json({
                        source: 'fallback',
                        reason: 'GEMINI_INVALID_JSON',
                        sample: generatedText.slice(0, 400),
                        schema: fallbackSchema(prompt, resolvedType),
                    });
                }
            }
        }
        if (!Array.isArray(schema.nodes) || !Array.isArray(schema.edges)) {
            return res.status(200).json({
                source: 'fallback',
                reason: 'GEMINI_INVALID_SHAPE',
                schema: fallbackSchema(prompt, resolvedType),
            });
        }
        return res.status(200).json({
            source: 'gemini',
            schema,
        });
    }
    catch (error) {
        console.error('Gemini API error:', error?.response?.data || error.message);
        return res.status(200).json({
            source: 'fallback',
            reason: 'GEMINI_REQUEST_FAILED',
            details: error?.response?.data || null,
            schema: fallbackSchema(prompt, resolvedType),
        });
    }
};
exports.generateDiagram = generateDiagram;
