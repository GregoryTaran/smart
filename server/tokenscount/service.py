# backend/tokenscount/service.py

from typing import Any, Optional


async def log_tokenscount(
    db,
    *,
    clientid: Optional[str] = None,
    clienttype: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    prompttokens: Optional[int] = None,
    completiontokens: Optional[int] = None,
    totaltokens: Optional[int] = None,
    rawusage: Optional[dict[str, Any]] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    """
    Записывает одну строку в таблицу tokenscount.
    Ничего не требует, кроме живого db-соединения.
    Все поля опциональны.
    """

    await db.execute(
        """
        INSERT INTO public.tokenscount (
          clientid,
          clienttype,
          provider,
          model,
          prompttokens,
          completiontokens,
          totaltokens,
          rawusage,
          meta
        )
        VALUES (
          :clientid,
          :clienttype,
          :provider,
          :model,
          :prompttokens,
          :completiontokens,
          :totaltokens,
          :rawusage,
          :meta
        )
        """,
        {
            "clientid": clientid,
            "clienttype": clienttype,
            "provider": provider,
            "model": model,
            "prompttokens": prompttokens,
            "completiontokens": completiontokens,
            "totaltokens": totaltokens,
            "rawusage": rawusage,
            "meta": meta,
        },
    )


async def log_tokenscount_from_usage(
    db,
    *,
    clientid: Optional[str],
    clienttype: Optional[str],
    provider: Optional[str],
    model: Optional[str],
    usage: Optional[dict[str, Any]],
    meta: Optional[dict[str, Any]] = None,
) -> None:
    """
    Удобная обёртка: на вход даёшь usage-словарь от провайдера.
    Если каких-то полей нет — забиваем, пишем что есть.
    """

    if usage is None:
        prompttokens = None
        completiontokens = None
        totaltokens = None
    else:
        prompttokens = usage.get("prompt_tokens")
        completiontokens = usage.get("completion_tokens")
        totaltokens = usage.get("total_tokens")

    await log_tokenscount(
        db,
        clientid=clientid,
        clienttype=clienttype,
        provider=provider,
        model=model,
        prompttokens=prompttokens,
        completiontokens=completiontokens,
        totaltokens=totaltokens,
        rawusage=usage,
        meta=meta,
    )
