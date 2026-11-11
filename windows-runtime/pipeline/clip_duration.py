"""Apply the requested duration before moment ranking and overlap selection."""
import math


def requested_duration(value):
    if value in (None, "", "auto", "0", 0):
        return None
    seconds = float(value)
    if not math.isfinite(seconds) or not seconds.is_integer() or not 10 <= seconds <= 120:
        raise ValueError("Choose a clip length between 10 and 120 seconds, or Auto.")
    return seconds


def fit_moments(moments, seconds, transcript):
    if seconds is None:
        return moments
    duration = float(transcript.get("duration", 0))
    if duration < seconds:
        raise ValueError(f"This video is only {duration:.1f} seconds long. Choose a shorter clip length.")
    words = [word for segment in transcript.get("segments", []) for word in segment.get("words", [])]
    adjusted = []
    for moment in moments:
        center = (float(moment["start"]) + float(moment["end"])) / 2
        start = round(max(0, min(duration - seconds, center - seconds / 2)), 3)
        end = round(start + seconds, 3)
        clip = {**moment, "start": start, "end": end, "duration": seconds, "requested_duration": seconds}
        # A candidate already close to the requested span needs less context
        # expansion/trimming. Preserve its content score while preferring it.
        clip["score"] = float(moment.get("score", 0)) + max(0, 8 - abs(float(moment["end"]) - float(moment["start"]) - seconds) / 3)
        clip["text"] = " ".join(str(word.get("text", word.get("word", ""))).strip() for word in words if float(word.get("start", 0)) >= start and float(word.get("start", 0)) < end)
        adjusted.append(clip)
    return adjusted
