export default function parse(json: string | undefined) {
    if (!json) {
        return {
            content: "No response generated",
            reasoning: "No response generated",
            tools: []
        };
    }
    try {
        const parsed = JSON.parse(json);

        return {
            content: parsed?.response ?? "",
            reasoning: parsed?.reasoning ?? "",
            tools: Array.isArray(parsed?.tools) ? parsed.tools : []
        };
    } catch {
        return {
            content: "",
            reasoning: "",
            tools: []
        };
    }
}
