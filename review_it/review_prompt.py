import re
from functools import lru_cache
from importlib import resources


@lru_cache(maxsize=1)
def get_review_prompt_template() -> str:
    source = resources.files("review_it").joinpath("review_prompt_source.js").read_text(encoding="utf-8")
    match = re.search(r"export const REVIEW_PROMPT_TEMPLATE = `(?P<prompt>.*)`;\s*export function", source, re.S)
    if not match:
        raise RuntimeError("Could not load bundled review prompt template.")
    return match.group("prompt")


def build_review_prompt(manuscript_text: str) -> str:
    return get_review_prompt_template().replace("[Paste manuscript here]", manuscript_text)
