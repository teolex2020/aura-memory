"""Concurrent Python threads must not deadlock recall, writes, or the embedding callback."""

import faulthandler
import tempfile
import threading
import time

from aura import Aura, Level

faulthandler.dump_traceback_later(180, exit=True)


def embed(text):
    time.sleep(0.001)  # hand the GIL to other threads inside the callback
    vector = [0.0] * 16
    for index, char in enumerate(text):
        vector[index % 16] += ord(char) / 1000
    return vector


with tempfile.TemporaryDirectory() as directory:
    brain = Aura(directory)
    brain.set_embedding_fn(embed)
    for index in range(30):
        brain.store(f"fact {index} about deployment", level=Level.Domain)

    stop = time.time() + 5
    errors = []

    def reader():
        while time.time() < stop:
            try:
                brain.recall("deployment fact", token_budget=512)
            except Exception as error:  # noqa: BLE001
                errors.append(error)

    def writer(worker):
        step = 0
        while time.time() < stop:
            try:
                record_id = brain.store(f"writer {worker} note {step}", level=Level.Working)
                brain.update(record_id, content=f"writer {worker} note {step} updated")
                brain.delete(record_id)
            except Exception as error:  # noqa: BLE001
                errors.append(error)
            step += 1

    threads = [threading.Thread(target=reader) for _ in range(3)]
    threads += [threading.Thread(target=writer, args=(worker,)) for worker in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors, errors[:3]

    # The directory is exclusively locked while open and released by close().
    try:
        Aura(directory)
    except Exception as error:  # noqa: BLE001
        assert "already open" in str(error), error
    else:
        raise AssertionError("second open of a locked brain succeeded")
    brain.close()
    Aura(directory).close()

    # Mode setters reject typos instead of silently turning features off.
    with tempfile.TemporaryDirectory() as other:
        fresh = Aura(other)
        try:
            fresh.set_belief_rerank_mode("limted")
        except ValueError:
            pass
        else:
            raise AssertionError("unknown rerank mode was accepted")
        fresh.set_belief_rerank_mode("limited")
        fresh.close()

    # A claim classifier runs without Aura's locks held: it may call back into
    # the same brain (here: recall) while other threads write.
    with tempfile.TemporaryDirectory() as other:
        reentrant = Aura(other)
        calls = []

        def classifier(text):
            calls.append(text)
            reentrant.recall("anything", token_budget=128)
            return "hearsay" if "rumor" in text.lower() else None

        reentrant.set_claim_classifier(classifier)

        def write_rumors(worker):
            for step in range(20):
                reentrant.store(f"rumor {worker}-{step}: the office moves", level=Level.Working)

        writers = [threading.Thread(target=write_rumors, args=(k,)) for k in range(3)]
        for thread in writers:
            thread.start()
        for thread in writers:
            thread.join()
        stored = reentrant.search(query="rumor")
        assert calls, "classifier was never called"
        assert stored and all(
            r.metadata.get("claim_certainty") == "hearsay" for r in stored
        ), stored[:1]
        reentrant.close()

print("python concurrency smoke passed")
