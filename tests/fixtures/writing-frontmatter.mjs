// Synthetic metadata; no user files or executable YAML processing.
export const yamlHeader = '\uFEFF---  \r\n# keep this comment\r\nname: "agent-memory"\r\ndescription: >-\r\n  开始重要任务，用 Rust amem 检索长期记忆；\r\n  保存已核实的结论。\r\ntext: "**literal ** \\(x\\)"\r\n---\r\n\r\n'
export const yamlBody = '# Agent Memory\n\n正文结尾。\n'
export const yamlMarkdown = yamlHeader + yamlBody
