"use client"

import {useEffect} from 'react'
import Prism from 'prismjs'
import loadLanguages from "prismjs/components/index"

type Props = {
  content: string;
};

function Markdown({html}: { html: string }) {
  return (<div className="markdown" dangerouslySetInnerHTML={{__html: html}}/>);
}

export function PostBody({content}: Props) {

  useEffect(() => {
    loadLanguages(['java']);
    Prism.highlightAll()
  }, [])

  return (
    <div className="max-w-6xl">
      <Markdown html={content}/>
    </div>
  );
}
