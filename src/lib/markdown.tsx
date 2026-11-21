import React from 'react';

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|https?:\/\/[^\s<]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('http://') || token.startsWith('https://')) {
      // Trim trailing punctuation from URLs
      let cleanUrl = token;
      let trailing = '';
      while (/[.,!?;:)\]]$/.test(cleanUrl)) {
        trailing = cleanUrl.slice(-1) + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
      }
      nodes.push(
        <a key={key} href={cleanUrl} target="_blank" rel="noopener noreferrer">
          {cleanUrl}
        </a>
      );
      if (trailing) nodes.push(trailing);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function renderMinimalMarkdown(text: string): React.ReactNode {
  const segments = text.split(/(```[\s\S]*?```)/g);

  return segments.map((segment, segIdx) => {
    if (segment.startsWith('```') && segment.endsWith('```')) {
      const inner = segment.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/, '');
      return (
        <pre key={`code-${segIdx}`}>
          <code>{inner}</code>
        </pre>
      );
    }

    const lines = segment.split('\n');
    return (
      <React.Fragment key={`txt-${segIdx}`}>
        {lines.map((line, lineIdx) => (
          <React.Fragment key={`line-${segIdx}-${lineIdx}`}>
            {renderInline(line, `${segIdx}-${lineIdx}`)}
            {lineIdx < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </React.Fragment>
    );
  });
}
