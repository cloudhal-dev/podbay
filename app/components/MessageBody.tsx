// Copyright 2026 Cloudhal and the Podbay contributors
// Licensed under the Apache 2.0 license found in the LICENSE file.

import { useBodyWithInlineImages } from "~/lib/attachments";
import type { Email } from "~/types";
import EmailIframe from "./EmailIframe";

/** A message's body in the mail frame, with the images the message embeds. */
export default function MessageBody({
	email,
	mailboxId,
	autoSize,
}: {
	email: Pick<Email, "id" | "body" | "attachments">;
	mailboxId: string | undefined;
	autoSize?: boolean;
}) {
	const body = useBodyWithInlineImages(email.body || "", mailboxId, email.id, email.attachments);
	return <EmailIframe body={body} autoSize={autoSize} />;
}
