import React from "react"
import { render, screen } from "@testing-library/react"

import AssistaTips from "../AssistaTips"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key, // Simple mock that returns the key
	}),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

describe("AssistaTips Component", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.runOnlyPendingTimers()
		vi.useRealTimers()
	})

	describe("when cycle is false (default)", () => {
		beforeEach(() => {
			render(<AssistaTips cycle={false} />)
		})

		test("renders only the top two tips", () => {
			// Ensure only two tips are present (check by link role)
			expect(screen.getAllByRole("link")).toHaveLength(2)
		})
	})
})
