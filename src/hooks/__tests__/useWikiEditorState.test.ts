/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWikiEditorState } from "../useWikiEditorState";

describe("useWikiEditorState", () => {
  it("initializes with default state", () => {
    const { result } = renderHook(() => useWikiEditorState());

    expect(result.current.state).toEqual({
      content: "",
      title: "",
      description: "",
      slug: "",
      category: "",
      tags: [],
      selectedTemplate: null,
      difficulty: null,
      featured: false,
      private: false,
      isDirty: false,
      isSaving: false,
      errors: {},
    });
  });

  it("updates field when SET_FIELD action dispatched", () => {
    const { result } = renderHook(() => useWikiEditorState());

    act(() => {
      result.current.dispatch({ type: "SET_FIELD", field: "title", value: "Test Title" });
    });

    expect(result.current.state.title).toBe("Test Title");
    expect(result.current.state.isDirty).toBe(true);
  });

  it("auto-generates slug from title", () => {
    const { result } = renderHook(() => useWikiEditorState());

    act(() => {
      result.current.dispatch({
        type: "SET_FIELD",
        field: "title",
        value: "Test Campaign Strategy",
      });
    });

    expect(result.current.state.slug).toBe("test-campaign-strategy");
  });

  it("sets template and pre-populates content", () => {
    const { result } = renderHook(() => useWikiEditorState());

    act(() => {
      result.current.dispatch({
        type: "SET_TEMPLATE",
        template: "game-mechanic",
        sections: "## Overview\n\n## How It Works\n\n",
      });
    });

    expect(result.current.state.selectedTemplate).toBe("game-mechanic");
    expect(result.current.state.content).toBe("## Overview\n\n## How It Works\n\n");
  });

  it("sets errors", () => {
    const { result } = renderHook(() => useWikiEditorState());

    act(() => {
      result.current.dispatch({
        type: "SET_ERRORS",
        errors: { title: "Title is required" },
      });
    });

    expect(result.current.state.errors).toEqual({ title: "Title is required" });
  });

  it("handles submit flow", () => {
    const { result } = renderHook(() => useWikiEditorState());

    act(() => {
      result.current.dispatch({ type: "SUBMIT_START" });
    });
    expect(result.current.state.isSaving).toBe(true);

    act(() => {
      result.current.dispatch({ type: "SUBMIT_SUCCESS" });
    });
    expect(result.current.state.isSaving).toBe(false);
    expect(result.current.state.isDirty).toBe(false);
  });

  it("loads draft", () => {
    const { result } = renderHook(() => useWikiEditorState());

    act(() => {
      result.current.dispatch({
        type: "LOAD_DRAFT",
        draft: { title: "Draft Title", content: "Draft content" },
      });
    });

    expect(result.current.state.title).toBe("Draft Title");
    expect(result.current.state.content).toBe("Draft content");
    expect(result.current.state.isDirty).toBe(true);
  });

  it("resets state", () => {
    const { result } = renderHook(() => useWikiEditorState());

    act(() => {
      result.current.dispatch({ type: "SET_FIELD", field: "title", value: "Test" });
      result.current.dispatch({ type: "RESET" });
    });

    expect(result.current.state.title).toBe("");
    expect(result.current.state.isDirty).toBe(false);
  });
});
