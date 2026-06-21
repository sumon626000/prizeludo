import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiRequest } from "../lib/api";

export function LegalPage({ document }: { document: "terms" | "privacy" }) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<{ content: string }>(`/api/home/legal/${document}`)
      .then((result) => setContent(result.content))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Request failed."),
      );
  }, [document]);

  return (
    <main className="page legal-page legal-page--premium">
      <section className="legal-card glass">
        <Link to="/" className="legal-back">
          <ArrowLeft size={16} /> {t("home")}
        </Link>
        <h1>{t(document)}</h1>
        {error ? (
          <p>{error}</p>
        ) : content ? (
          <div
            className="legal-rich-content"
            dangerouslySetInnerHTML={{ __html: content }}
          />
        ) : (
          <p>{t("working")}</p>
        )}
      </section>
    </main>
  );
}
