// Core Node.js imports
import path from "path"
import fs from "fs/promises"
import delay from "delay"

// Internal imports
import { Task } from "../task/Task"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag, ToolUse } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { AssistaSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { fileExistsAtPath } from "../../utils/fs"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"

/**
 * Tool for performing search and replace operations on files
 * Supports regex and case-sensitive/insensitive matching
 */

/**
 * Validates required parameters for search and replace operation
 */
async function validateParams(
	assista: Task,
	relPath: string | undefined,
	search: string | undefined,
	replace: string | undefined,
	pushToolResult: PushToolResult,
): Promise<boolean> {
	if (!relPath) {
		assista.consecutiveMistakeCount++
		assista.recordToolError("search_and_replace")
		pushToolResult(await assista.sayAndCreateMissingParamError("search_and_replace", "path"))
		return false
	}

	if (!search) {
		assista.consecutiveMistakeCount++
		assista.recordToolError("search_and_replace")
		pushToolResult(await assista.sayAndCreateMissingParamError("search_and_replace", "search"))
		return false
	}

	if (replace === undefined) {
		assista.consecutiveMistakeCount++
		assista.recordToolError("search_and_replace")
		pushToolResult(await assista.sayAndCreateMissingParamError("search_and_replace", "replace"))
		return false
	}

	return true
}

/**
 * Performs search and replace operations on a file
 * @param assista - Assista instance
 * @param block - Tool use parameters
 * @param askApproval - Function to request user approval
 * @param handleError - Function to handle errors
 * @param pushToolResult - Function to push tool results
 * @param removeClosingTag - Function to remove closing tags
 */
export async function searchAndReplaceTool(
	assista: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
): Promise<void> {
	// Extract and validate parameters
	const relPath: string | undefined = block.params.path
	const search: string | undefined = block.params.search
	const replace: string | undefined = block.params.replace
	const useRegex: boolean = block.params.use_regex === "true"
	const ignoreCase: boolean = block.params.ignore_case === "true"
	const startLine: number | undefined = block.params.start_line ? parseInt(block.params.start_line, 10) : undefined
	const endLine: number | undefined = block.params.end_line ? parseInt(block.params.end_line, 10) : undefined

	try {
		// Handle partial tool use
		if (block.partial) {
			const partialMessageProps = {
				tool: "searchAndReplace" as const,
				path: getReadablePath(assista.cwd, removeClosingTag("path", relPath)),
				search: removeClosingTag("search", search),
				replace: removeClosingTag("replace", replace),
				useRegex: block.params.use_regex === "true",
				ignoreCase: block.params.ignore_case === "true",
				startLine,
				endLine,
			}
			await assista.ask("tool", JSON.stringify(partialMessageProps), block.partial).catch(() => {})
			return
		}

		// Validate required parameters
		if (!(await validateParams(assista, relPath, search, replace, pushToolResult))) {
			return
		}

		// At this point we know relPath, search and replace are defined
		const validRelPath = relPath as string
		const validSearch = search as string
		const validReplace = replace as string

		const sharedMessageProps: AssistaSayTool = {
			tool: "searchAndReplace",
			path: getReadablePath(assista.cwd, validRelPath),
			search: validSearch,
			replace: validReplace,
			useRegex: useRegex,
			ignoreCase: ignoreCase,
			startLine: startLine,
			endLine: endLine,
		}

		const accessAllowed = assista.assistaIgnoreController?.validateAccess(validRelPath)

		if (!accessAllowed) {
			await assista.say("assistaignore_error", validRelPath)
			pushToolResult(formatResponse.toolError(formatResponse.assistaIgnoreError(validRelPath)))
			return
		}

		// Check if file is write-protected
		const isWriteProtected = assista.assistaProtectedController?.isWriteProtected(validRelPath) || false

		const absolutePath = path.resolve(assista.cwd, validRelPath)
		const fileExists = await fileExistsAtPath(absolutePath)

		if (!fileExists) {
			assista.consecutiveMistakeCount++
			assista.recordToolError("search_and_replace")
			const formattedError = formatResponse.toolError(
				`File does not exist at path: ${absolutePath}\nThe specified file could not be found. Please verify the file path and try again.`,
			)
			await assista.say("error", formattedError)
			pushToolResult(formattedError)
			return
		}

		// Reset consecutive mistakes since all validations passed
		assista.consecutiveMistakeCount = 0

		// Read and process file content
		let fileContent: string
		try {
			fileContent = await fs.readFile(absolutePath, "utf-8")
		} catch (error) {
			assista.consecutiveMistakeCount++
			assista.recordToolError("search_and_replace")
			const errorMessage = `Error reading file: ${absolutePath}\nFailed to read the file content: ${
				error instanceof Error ? error.message : String(error)
			}\nPlease verify file permissions and try again.`
			const formattedError = formatResponse.toolError(errorMessage)
			await assista.say("error", formattedError)
			pushToolResult(formattedError)
			return
		}

		// Create search pattern and perform replacement
		const flags = ignoreCase ? "gi" : "g"
		const searchPattern = useRegex ? new RegExp(validSearch, flags) : new RegExp(escapeRegExp(validSearch), flags)

		let newContent: string
		if (startLine !== undefined || endLine !== undefined) {
			// Handle line-specific replacement
			const lines = fileContent.split("\n")
			const start = Math.max((startLine ?? 1) - 1, 0)
			const end = Math.min((endLine ?? lines.length) - 1, lines.length - 1)

			// Get content before and after target section
			const beforeLines = lines.slice(0, start)
			const afterLines = lines.slice(end + 1)

			// Get and modify target section
			const targetContent = lines.slice(start, end + 1).join("\n")
			const modifiedContent = targetContent.replace(searchPattern, validReplace)
			const modifiedLines = modifiedContent.split("\n")

			// Reconstruct full content
			newContent = [...beforeLines, ...modifiedLines, ...afterLines].join("\n")
		} else {
			// Global replacement
			newContent = fileContent.replace(searchPattern, validReplace)
		}

		// Initialize diff view
		assista.diffViewProvider.editType = "modify"
		assista.diffViewProvider.originalContent = fileContent

		// Generate and validate diff
		const diff = formatResponse.createPrettyPatch(validRelPath, fileContent, newContent)
		if (!diff) {
			pushToolResult(`No changes needed for '${relPath}'`)
			await assista.diffViewProvider.reset()
			return
		}

		// Show changes in diff view
		if (!assista.diffViewProvider.isEditing) {
			await assista.ask("tool", JSON.stringify(sharedMessageProps), true).catch(() => {})
			await assista.diffViewProvider.open(validRelPath)
			await assista.diffViewProvider.update(fileContent, false)
			assista.diffViewProvider.scrollToFirstDiff()
			await delay(200)
		}

		await assista.diffViewProvider.update(newContent, true)

		// Request user approval for changes
		const completeMessage = JSON.stringify({
			...sharedMessageProps,
			diff,
			isProtected: isWriteProtected,
		} satisfies AssistaSayTool)
		const didApprove = await assista
			.ask("tool", completeMessage, isWriteProtected)
			.then((response) => response.response === "yesButtonClicked")

		if (!didApprove) {
			await assista.diffViewProvider.revertChanges()
			pushToolResult("Changes were rejected by the user.")
			await assista.diffViewProvider.reset()
			return
		}

		// Call saveChanges to update the DiffViewProvider properties
		await assista.diffViewProvider.saveChanges()

		// Track file edit operation
		if (relPath) {
			await assista.fileContextTracker.trackFileContext(relPath, "assista_edited" as RecordSource)
		}

		assista.didEditFile = true

		// Get the formatted response message
		const message = await assista.diffViewProvider.pushToolWriteResult(
			assista,
			assista.cwd,
			false, // Always false for search_and_replace
		)

		pushToolResult(message)

		// Record successful tool usage and cleanup
		assista.recordToolUsage("search_and_replace")
		await assista.diffViewProvider.reset()
	} catch (error) {
		handleError("search and replace", error)
		await assista.diffViewProvider.reset()
	}
}

/**
 * Escapes special regex characters in a string
 * @param input String to escape regex characters in
 * @returns Escaped string safe for regex pattern matching
 */
function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
