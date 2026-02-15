export default function parse(json: string |undefined) {
    if (!json) {
         return {
            response: "No response generated",
            reasoning: "No response generated",
            tools: []
        }
    }
    try {
        const parsed = JSON.parse(json)

        return {
            content: parsed?.response ?? "",
            reasoning: parsed?.reasoning ?? "",
            tools: Array.isArray(parsed?.tools) ? parsed.tools : []
        }
    } catch {
        return {
            response: "",
            reasoning: "",
            tools: []
        }
    }
}
